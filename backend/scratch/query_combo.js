const { poolPromise } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    console.log("Connected to DB. Querying DishMaster for active combos...");
    
    const combos = await pool.request().query(`
      SELECT DishId, Name, IsCombo, IsActive 
      FROM DishMaster 
      WHERE IsCombo = 1
    `);
    console.log("Combos found:", combos.recordset);

    if (combos.recordset.length > 0) {
      for (const combo of combos.recordset) {
        console.log(`\n--- Config for ${combo.Name} (${combo.DishId}) ---`);
        
        const groups = await pool.request()
          .input("DishId", combo.DishId)
          .query(`
            SELECT ComboGroupId, GroupName, DisplayOrder, MinSelection, MaxSelection, IsMultiSelect, IsActive
            FROM ComboGroupMaster
            WHERE ParentComboDishId = @DishId
          `);
        console.log("Groups:", groups.recordset);

        if (groups.recordset.length > 0) {
          const groupIds = groups.recordset.map(g => `'${g.ComboGroupId}'`).join(",");
          const options = await pool.request().query(`
            SELECT m.MappingId, m.ComboGroupId, m.DishId, d.Name AS DishName, m.IsActive
            FROM ComboGroupDishMapping m
            INNER JOIN DishMaster d ON m.DishId = d.DishId
            WHERE m.ComboGroupId IN (${groupIds})
          `);
          console.log("Options:", options.recordset);
        }
      }
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
