const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

// Middleware to authenticate the print bridge requests
const authenticateBridge = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const storeId = req.headers['x-store-id'] || req.query.storeId || req.body.storeId;

  const expectedToken = process.env.BRIDGE_TOKEN || 'unipro-pos-bridge-token-2026';

  if (!token || token !== expectedToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Bridge Token' });
  }

  if (!storeId) {
    return res.status(400).json({ success: false, error: 'Bad Request: Missing Store ID' });
  }

  req.storeId = storeId;
  next();
};

// 1. POST /api/print-jobs/auth - Verify connection on bridge startup
router.post('/auth', authenticateBridge, (req, res) => {
  res.json({ success: true, message: 'Authenticated successfully', storeId: req.storeId });
});

let lastBridgeActivity = 0;
let lastBridgeIp = '';

const normalizeIp = (ip) => {
  if (!ip) return '';
  const match = ip.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
  if (match) return match[1];
  return ip.trim();
};

// GET /api/print-jobs/bridge-status - Check if print bridge is active/online
router.get('/bridge-status', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT DATEDIFF(SECOND, LastBridgeHeartbeat, GETDATE()) AS SecondsSinceHeartbeat 
      FROM CompanySettings 
      WHERE Id = '1'
    `);
    if (result.recordset.length > 0 && result.recordset[0].SecondsSinceHeartbeat !== null) {
      const isOnline = result.recordset[0].SecondsSinceHeartbeat < 8; // 8 seconds threshold
      return res.json({ success: true, online: isOnline });
    }
    const isOnline = (Date.now() - lastBridgeActivity) < 8000;
    res.json({ success: true, online: isOnline });
  } catch (err) {
    console.error('Error checking print bridge status:', err);
    const isOnline = (Date.now() - lastBridgeActivity) < 8000;
    res.json({ success: true, online: isOnline });
  }
});

// 2. GET /api/print-jobs/pending - Fetch pending jobs for the store
router.get('/pending', authenticateBridge, async (req, res) => {
  lastBridgeActivity = Date.now();
  lastBridgeIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  try {
    const pool = await poolPromise;

    // Persist heartbeat in DB to support multi-instance servers/restarts
    try {
      await pool.request().query("UPDATE CompanySettings SET LastBridgeHeartbeat = GETDATE() WHERE Id = '1'");
    } catch (dbErr) {
      console.error('Failed to save bridge heartbeat in database:', dbErr.message);
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      // Select pending jobs
      const selectReq = new sql.Request(transaction);
      const result = await selectReq
        .input('StoreId', sql.NVarChar(50), req.storeId)
        .query(`
          SELECT JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, Attempts
          FROM PrintJobQueue
          WHERE StoreId = @StoreId AND Status = 'PENDING'
          ORDER BY CreatedOn ASC
        `);

      const jobs = result.recordset || [];

      if (jobs.length > 0) {
        // Mark them as PROCESSING
        const jobIds = jobs.map(j => `'${j.JobId}'`).join(',');
        const updateReq = new sql.Request(transaction);
        await updateReq.query(`
          UPDATE PrintJobQueue
          SET Status = 'PROCESSING', ProcessedOn = GETDATE(), Attempts = Attempts + 1
          WHERE JobId IN (${jobIds})
        `);
      }

      await transaction.commit();
      res.json({ success: true, data: jobs });

    } catch (innerErr) {
      try { await transaction.rollback(); } catch (e) {}
      throw innerErr;
    }

  } catch (err) {
    console.error('Error fetching pending print jobs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/print-jobs/:jobId/complete - Mark job as completed
router.post('/:jobId/complete', authenticateBridge, async (req, res) => {
  try {
    const { jobId } = req.params;
    const pool = await poolPromise;
    
    await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .query(`
        UPDATE PrintJobQueue
        SET Status = 'COMPLETED', CompletedOn = GETDATE()
        WHERE JobId = @JobId
      `);

    res.json({ success: true, message: 'Job completed successfully' });
  } catch (err) {
    console.error('Error completing print job:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/print-jobs/:jobId/failed - Mark job as failed
router.post('/:jobId/failed', authenticateBridge, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { errorMessage } = req.body;
    const pool = await poolPromise;

    await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .input('ErrorMessage', sql.NVarChar(sql.MAX), errorMessage || 'Unknown Error')
      .query(`
        UPDATE PrintJobQueue
        SET Status = 'FAILED', ErrorMessage = @ErrorMessage, CompletedOn = GETDATE()
        WHERE JobId = @JobId
      `);

    res.json({ success: true, message: 'Job failure recorded' });
  } catch (err) {
    console.error('Error recording print job failure:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST /api/print-jobs - Queue a new print job from the frontend Web version
router.post('/', authenticateBridge, async (req, res) => {
  try {
    const { printerType, kitchenTypeValue, content } = req.body;
    const storeId = req.storeId;

    if (printerType === undefined || !content) {
      return res.status(400).json({ success: false, error: 'Missing required fields: printerType and content' });
    }

    const pool = await poolPromise;

    // Resolve Printer IP and Name from PrintMaster
    let printerIp = '';
    let printerName = '';
    const pType = parseInt(printerType);

    if (pType === 2) {
      // Kitchen Printer
      const codeVal = parseInt(kitchenTypeValue);
      const appSettingsRes = await pool.request().query("SELECT TOP 1 EnableBeveragePrinter, EnableMainMenuPrinter, EnableThaiPrinter FROM AppSettings");
      const asRow = appSettingsRes.recordset[0] || {};
      const enableBev = asRow.EnableBeveragePrinter !== false && asRow.EnableBeveragePrinter !== 0;
      const enableMain = asRow.EnableMainMenuPrinter !== false && asRow.EnableMainMenuPrinter !== 0;
      const enableThai = asRow.EnableThaiPrinter !== false && asRow.EnableThaiPrinter !== 0;

      let isPrinterEnabled = true;
      if (codeVal === 5) isPrinterEnabled = enableBev;
      else if (codeVal === 2) isPrinterEnabled = enableMain;
      else if (codeVal === 11) isPrinterEnabled = enableThai;

      if (!isPrinterEnabled) {
        console.log(`📡 [printJobs] Skipping print job for KitchenTypeValue ${kitchenTypeValue} because it is disabled in AppSettings.`);
        return res.json({ success: true, message: 'Print job skipped (printer disabled)' });
      }

      const checkPrinter = await pool.request()
        .input('KitchenTypeValue', sql.NVarChar(50), kitchenTypeValue ? String(kitchenTypeValue) : '0')
        .query(`
          SELECT IsActive, PrinterIP, PrinterName 
          FROM PrintMaster 
          WHERE PrinterType = 2 AND CAST(KitchenTypeValue AS VARCHAR(50)) = CAST(@KitchenTypeValue AS VARCHAR(50)) AND IsActive = 1
        `);
      if (checkPrinter.recordset.length > 0) {
        const kp = checkPrinter.recordset[0];
        printerIp = kp.PrinterIP || '';
        printerName = kp.PrinterName || '';
      }
    }

    // Fallback or Direct check for Cashier (1) or TakeAway (3) or if Kitchen Printer not found/not configured with IP
    if (!printerIp || printerIp.trim() === '') {
      const printerRes = await pool.request()
        .input('PrinterType', sql.Int, pType)
        .query(`
          SELECT TOP 1 PrinterIP, PrinterName 
          FROM PrintMaster 
          WHERE PrinterType = @PrinterType AND IsActive = 1 AND PrinterIP IS NOT NULL AND PrinterIP <> ''
        `);
      if (printerRes.recordset.length > 0) {
        printerIp = printerRes.recordset[0].PrinterIP;
        printerName = printerRes.recordset[0].PrinterName;
      }
    }

    // Ultimate fallback to Cashier Printer (Type 1)
    if (!printerIp || printerIp.trim() === '') {
      const cashierRes = await pool.request()
        .query(`
          SELECT TOP 1 PrinterIP, PrinterName 
          FROM PrintMaster 
          WHERE PrinterType = 1 AND IsActive = 1 AND PrinterIP IS NOT NULL AND PrinterIP <> ''
        `);
      if (cashierRes.recordset.length > 0) {
        printerIp = cashierRes.recordset[0].PrinterIP;
        printerName = cashierRes.recordset[0].PrinterName;
      } else {
        return res.status(400).json({ success: false, error: 'No active printer configured in database' });
      }
    }

    const jobId = require('crypto').randomUUID();

    // Insert the job into PrintJobQueue
    await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .input('StoreId', sql.NVarChar(50), storeId)
      .input('PrinterName', sql.NVarChar(100), printerName)
      .input('PrinterIp', sql.NVarChar(100), printerIp)
      .input('PrinterPort', sql.Int, 9100) // Default thermal printer raw TCP port
      .input('Content', sql.NVarChar(sql.MAX), content)
      .query(`
        INSERT INTO PrintJobQueue (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn)
        VALUES (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE())
      `);

    res.json({ success: true, message: 'Print job queued successfully', jobId, printerIp, printerName });
  } catch (err) {
    console.error('Error queuing print job:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/print-jobs/status/:jobId - Check print job status
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .query(`
        SELECT Status, ErrorMessage 
        FROM PrintJobQueue 
        WHERE JobId = @JobId
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }
    res.json({ success: true, status: result.recordset[0].Status, error: result.recordset[0].ErrorMessage });
  } catch (err) {
    console.error('Error fetching print job status:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
