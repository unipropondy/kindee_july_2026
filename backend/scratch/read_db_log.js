const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("EXEC xp_readerrorlog 0, 1, NULL, NULL, NULL, NULL, 'DESC'");
    console.log("Database Error Log:");
    console.log(result.recordset.slice(0, 50));
  } catch (err) {
    console.error("Error reading db log:", err);
  }
  process.exit(0);
}

run();
