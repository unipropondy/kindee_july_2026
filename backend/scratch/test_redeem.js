const sql = require("mssql");
const { poolPromise } = require("../config/db");

async function test() {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query("SELECT MemberId, Name, CreditLimit, CurrentBalance, RewardCredit, AvailableCredit FROM MemberMaster WHERE Name LIKE '%Azmi%'");
    console.log("Azmi record details:", res.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
test();
