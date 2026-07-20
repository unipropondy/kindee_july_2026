const { poolPromise, sql } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    
    const result = await pool.request()
      .input("orderNo", sql.NVarChar(50), "20260720-0023")
      .query(`
        SELECT 
          d.OrderDetailId as lineItemId, d.DishId as id, d.Quantity as qty, 
          dish.Name as name, d.Remarks as note, d.ModifiersJSON, d.isTakeAway,
          d.ComboDetailsJSON,
          ISNULL(ckt.KitchenTypeName, cat.CategoryName) as KitchenTypeName,
          pm.PrinterName,
          pm.PrinterPath as PrinterIP,
          pm.IsEnabled as IsPrinterEnabled,
          ckt.KitchenTypeCode,
          pm.KitchenTypeValue
        FROM RestaurantOrderDetailCur d 
        JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
        LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
        LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
        LEFT JOIN PrintMaster pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.PrinterType = 2
        WHERE h.OrderNumber = @orderNo
      `);
    console.log("Resolved printer for 20260720-0023:");
    console.table(result.recordset);
  } catch (err) {
    console.error("Error executing query:", err);
  }
  process.exit(0);
}

run();
