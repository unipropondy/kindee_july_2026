const sql = require("mssql");
const { poolPromise } = require("../config/db.js");

async function run() {
  try {
    const pool = await poolPromise;
    
    console.log("=== RestaurantOrderCur for 20260701-0079 ===");
    const cur = await pool.request().query("SELECT OrderId, OrderNumber, TotalAmount, StatusCode, isOrderClosed FROM RestaurantOrderCur WHERE OrderNumber LIKE '%79%' OR OrderNumber LIKE '%78%'");
    console.log(cur.recordset);

    console.log("=== RestaurantInvoice for 20260701-0079 ===");
    const inv = await pool.request().query("SELECT OrderId, BillNumber, RestaurantBillId, TotalAmount FROM RestaurantInvoice WHERE BillNumber LIKE '%79%' OR BillNumber LIKE '%78%'");
    console.log(inv.recordset);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
