const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT TOP 5 SettlementID, BillNo, SysAmount, CreatedOn FROM SettlementHeader ORDER BY CreatedOn DESC");
    console.log("Recent Settlements:");
    console.table(result.recordset);
  } catch (err) {
    console.error("Error fetching settlements:", err);
  }
  process.exit(0);
}

run();
