const jwt = require("jsonwebtoken");
const { poolPromise } = require("../config/db");

const secret = "9e581b685316ce4d65d29444725ca823b8d3603a7a78c4c8156fd61102478147";

async function run() {
  try {
    const pool = await poolPromise;
    
    // Get a real DishId
    const dishRes = await pool.request().query("SELECT TOP 1 DishId, Name FROM DishMaster");
    const dish = dishRes.recordset[0] || { DishId: "A1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D", Name: "Lemon Tea" };
    console.log("Using Dish:", dish);

    // Get active table
    const tableRes = await pool.request().query("SELECT TOP 1 TableId, TableNumber FROM TableMaster");
    const table = tableRes.recordset[0] || { TableId: "B1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D", TableNumber: "T5" };

    // Generate JWT
    const token = jwt.sign(
      { userId: "8C026364-77E7-4002-803B-9BBE187C60BD", role: "ADMIN", userName: "Cashier" },
      secret,
      { expiresIn: "1h" }
    );

    // Generate a fresh settlementId
    const crypto = require("crypto");
    const settlementId = crypto.randomUUID();

    const payload = {
      settlementId: settlementId,
      totalAmount: 1.64,
      paymentMethod: "MEMBER",
      items: [
        {
          lineItemId: crypto.randomUUID(),
          dishId: dish.DishId,
          name: dish.Name,
          qty: 1,
          price: 1.50
        }
      ],
      subTotal: 1.50,
      taxAmount: 0.14,
      discountAmount: 0,
      discountType: "fixed",
      roundOff: 0,
      orderType: "DINE-IN",
      tableNo: table.TableNumber,
      section: "Section-1",
      memberId: "2EB4F59E-A26C-4128-8160-7EF23A164364", // Javi
      cashierId: "8C026364-77E7-4002-803B-9BBE187C60BD",
      tableId: table.TableId
    };

    console.log("Sending POST to http://localhost:3001/api/sales/save...");
    const response = await fetch("http://localhost:3001/api/sales/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const status = response.status;
    const bodyText = await response.text();
    console.log(`Response Status: ${status}`);
    console.log("Response Body:", bodyText);

  } catch (err) {
    console.error("Test trigger failed:", err);
  }
  process.exit(0);
}

run();
