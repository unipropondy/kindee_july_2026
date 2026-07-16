import ThermalPrinter from "react-native-thermal-printer";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";
import SunmiPrinterService from "../components/SunmiPrinterService";
import { API_URL } from "../constants/Config";
import { Platform } from "react-native";

let isPolling = false;
let pollingInterval: any = null;
const processedJobs = new Set<string>();

// Keep memory bounded by clearing the processed jobs cache if it gets too large
function cleanProcessedJobsCache() {
  if (processedJobs.size > 1000) {
    processedJobs.clear();
  }
}

async function processJob(job: any, pollerUrl: string, token: string, storeId: string) {
  const targetIp = (job.PrinterIp || job.PrinterIP || "").trim();
  const targetPort = job.PrinterPort || 9100;
  const content = job.Content || "";
  const jobId = job.JobId;

  if (!jobId) return;

  // Prevent duplicate execution if job is already processed/processing
  if (processedJobs.has(jobId)) {
    console.log(`[BackgroundPrinterPoller] Duplicate print job ${jobId} blocked.`);
    return;
  }

  processedJobs.add(jobId);
  cleanProcessedJobsCache();

  console.log(`[BackgroundPrinterPoller] Processing job ${jobId} to printer ${targetIp || "Sunmi"}`);

  try {
    // If running in Web environment, simulate the print for local testing/verification
    if (Platform.OS === "web") {
      console.log(`\n========================================`);
      console.log(`🖨️ [Web Mock Print] SIMULATING PRINT FOR JOB: ${jobId}`);
      console.log(`Target Printer: ${targetIp || "Sunmi Fallback"}:${targetPort}`);
      console.log(`----------------------------------------`);
      console.log(content);
      console.log(`========================================\n`);
      
      // Artificial delay to simulate printer hardware response time
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      // Actual hardware print on Android
      const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(targetIp);
      const isMac = /^(?:[0-9A-Fa-f]{2}[:-]){5}(?:[0-9A-Fa-f]{2})$/.test(targetIp);

      if (isIp) {
        console.log(`[BackgroundPrinterPoller] WiFi/LAN print to: ${targetIp}:${targetPort}`);
        if (!ThermalPrinter || typeof ThermalPrinter.printTcp !== 'function') {
          throw new Error("ThermalPrinter native module not available (printTcp)");
        }
        await ThermalPrinter.printTcp({
          ip: targetIp,
          port: Number(targetPort),
          payload: content,
          mmFeedPaper: 60,
        });
      } else if (isMac) {
        console.log(`[BackgroundPrinterPoller] Bluetooth print to: ${targetIp}`);
        if (!ThermalPrinter || typeof ThermalPrinter.printBluetooth !== 'function') {
          throw new Error("ThermalPrinter native module not available (printBluetooth)");
      }
        await ThermalPrinter.printBluetooth({
          macAddress: targetIp,
          payload: content,
          mmFeedPaper: 60,
        });
      } else {
        console.log(`[BackgroundPrinterPoller] Sunmi print (direct raw KOT)`);
        const success = await SunmiPrinterService.printRawKOT(content);
        if (!success) {
          throw new Error("SunmiPrinterService.printRawKOT returned false");
        }
      }
    }

    console.log(`[BackgroundPrinterPoller] Successfully printed job ${jobId}. Reporting to backend...`);

    // Report success to backend
    const res = await fetch(`${pollerUrl}/api/print-jobs/${jobId}/complete`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-store-id": storeId,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      console.error(`[BackgroundPrinterPoller] Failed to mark job ${jobId} as complete: ${res.statusText}`);
      processedJobs.delete(jobId);
    }
  } catch (err: any) {
    const errorMsg = err.message || "Silent print failed";
    console.error(`[BackgroundPrinterPoller] Printing job ${jobId} failed: ${errorMsg}`);
    
    processedJobs.delete(jobId);

    // Report failure to backend
    try {
      const res = await fetch(`${pollerUrl}/api/print-jobs/${jobId}/failed`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "x-store-id": storeId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ errorMessage: errorMsg }),
      });
      if (!res.ok) {
        console.error(`[BackgroundPrinterPoller] Failed to mark job ${jobId} as failed on backend: ${res.statusText}`);
      }
    } catch (reportErr) {
      console.error("[BackgroundPrinterPoller] Error reporting print failure:", reportErr);
    }
  }
}

async function pollOnce() {
  if (isPolling) return;
  
  const settings = useGeneralSettingsStore.getState().settings;
  if (!settings.enablePrintPoller) {
    return;
  }

  isPolling = true;

  let pollerUrl = settings.printPollerUrl || "https://qr-kindee-production.up.railway.app";
  
  if (__DEV__ && (pollerUrl.includes("railway.app") || !pollerUrl)) {
    pollerUrl = API_URL.replace(":3000", ":5000");
  }

  const token = settings.printPollerToken || "unipro-pos-bridge-token-2026";
  const storeId = settings.printPollerStoreId || "1";

  try {
    const res = await fetch(`${pollerUrl}/api/print-jobs/pending`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-store-id": storeId,
      },
    });

    if (!res.ok) {
      console.warn(`[BackgroundPrinterPoller] Failed to fetch pending jobs from ${pollerUrl}: ${res.statusText}`);
      isPolling = false;
      return;
    }

    const payload = await res.json();
    if (payload.success && Array.isArray(payload.data) && payload.data.length > 0) {
      console.log(`[BackgroundPrinterPoller] Found ${payload.data.length} pending print jobs.`);
      
      for (const job of payload.data) {
        await processJob(job, pollerUrl, token, storeId);
      }
    }
  } catch (err) {
    console.error("[BackgroundPrinterPoller] Poll cycle error:", err);
  } finally {
    isPolling = false;
  }
}

export function startBackgroundPrinterPoller() {
  if (pollingInterval) {
    console.log("[BackgroundPrinterPoller] Poller already running.");
    return;
  }

  console.log("[BackgroundPrinterPoller] Starting print poller...");
  
  pollOnce();
  pollingInterval = setInterval(pollOnce, 5000);
}

export function stopBackgroundPrinterPoller() {
  if (pollingInterval) {
    console.log("[BackgroundPrinterPoller] Stopping print poller.");
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
