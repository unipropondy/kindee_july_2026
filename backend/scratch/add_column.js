const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    console.log("Running migration...");
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[MemberMaster]') AND name = 'AvailableCredit')
      BEGIN
          ALTER TABLE [dbo].[MemberMaster] ADD AvailableCredit AS (CASE WHEN CreditLimit > 0 THEN (CreditLimit - CurrentBalance) ELSE CurrentBalance END);
          PRINT 'Added AvailableCredit column';
      END
      ELSE
      BEGIN
          PRINT 'AvailableCredit column already exists';
      END
    `);
    console.log("Migration finished successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  }
  process.exit(0);
}

run();
