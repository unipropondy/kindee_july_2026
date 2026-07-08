const sql = require("mssql");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query("UPDATE MemberMaster SET Promoamount = 4.00 WHERE Promocode = 'loki10'");
    console.log("Promo amount restored:", res.rowsAffected);
  } catch (err) {
    console.error(err);
  } finally {
    sql.close();
  }
}

run();
