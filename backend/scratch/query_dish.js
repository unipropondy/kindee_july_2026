const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT pdcgm.*, d.Name AS ParentDishName, cgm.GroupName
      FROM ParentDishComboGroupMapping pdcgm
      LEFT JOIN DishMaster d ON pdcgm.ParentDishId = d.DishId
      LEFT JOIN ComboGroupMaster cgm ON pdcgm.ComboGroupId = cgm.ComboGroupId
    `);
    console.log("All records in ParentDishComboGroupMapping:", result.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
