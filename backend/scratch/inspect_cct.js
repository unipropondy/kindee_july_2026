const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'CustomerCreditTransactions'
    `);
    console.log("CustomerCreditTransactions Columns:");
    console.table(result.recordset);
  } catch (err) {
    console.error("Error inspecting schema:", err);
  }
  process.exit(0);
}

run();
