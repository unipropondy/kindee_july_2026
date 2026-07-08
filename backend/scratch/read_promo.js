const sql = require("mssql");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { poolPromise } = require("../config/db");

async function check() {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query("SELECT MemberId, Name, Phone, Promocode, Promoamount FROM MemberMaster WHERE Promocode = 'loki10'");
    console.log("Member Master:", res.recordset);
    
    // Check if there are any invoices with this discount/remarks
    const res2 = await pool.request().query("SELECT RestaurantBillId, BillNumber, OrderDateTime, TotalLineItemAmount, DiscountAmount, DiscountRemarks, TotalDiscountAmount FROM RestaurantInvoice WHERE DiscountRemarks LIKE '%Promo%'");
    console.log("Invoices with Promo:", res2.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    sql.close();
  }
}

check();
