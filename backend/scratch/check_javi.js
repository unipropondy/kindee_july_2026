const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT * FROM MemberMaster WHERE Name LIKE '%Javi%'");
    console.log("Javi Member details:");
    console.log(result.recordset);
  } catch (err) {
    console.error("Error fetching Javi details:", err);
  }
  process.exit(0);
}

run();
