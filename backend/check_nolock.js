const { poolPromise } = require("./config/db");

async function checkNoLock() {
  try {
    console.log("Fetching with WITH (NOLOCK)...");
    const pool = await poolPromise;
    if (!pool) {
      console.error("Could not connect to pool");
      return;
    }
    const start = Date.now();
    const result = await pool.request().query(`
      SELECT * FROM ComboGroupDishMapping WITH (NOLOCK)
    `);
    console.log(`Success in ${Date.now() - start}ms! Rows count:`, result.recordset.length);
  } catch (err) {
    console.error("Failed:", err);
  } finally {
    process.exit(0);
  }
}

checkNoLock();
