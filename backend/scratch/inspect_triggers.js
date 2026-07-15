const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        t.name AS TriggerName,
        o.name AS TableName,
        m.definition AS TriggerDefinition
      FROM sys.triggers t
      INNER JOIN sys.objects o ON t.parent_id = o.object_id
      INNER JOIN sys.sql_modules m ON t.object_id = m.object_id
      WHERE o.name = 'MemberMaster'
    `);
    console.log("Triggers on MemberMaster:");
    console.table(result.recordset);
  } catch (err) {
    console.error("Error inspecting triggers:", err);
  }
  process.exit(0);
}

run();
