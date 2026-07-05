const sql = require("mssql");
const { poolPromise } = require("../config/db.js");

async function run() {
  try {
    const pool = await poolPromise;
    console.log("=== SettlementHeader ===");
    const resHeaders = await pool.request().query("SELECT TOP 50 SettlementID, BillNo, CreatedOn, SysAmount, IsCancelled FROM SettlementHeader ORDER BY CreatedOn DESC");
    console.table(resHeaders.recordset);

    console.log("=== RestaurantInvoice ===");
    const resInvoices = await pool.request().query("SELECT TOP 50 RestaurantBillId, OrderId, BillNumber, CreatedOn, TotalAmount FROM RestaurantInvoice ORDER BY CreatedOn DESC");
    console.table(resInvoices.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
