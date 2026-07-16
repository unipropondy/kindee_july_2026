const express = require("express");
const router = express.Router();
const { poolPromise, sql } = require("../config/db");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set!");
}
const bcrypt = require("bcryptjs");

/* ================= AUTH - LOGIN ================= */
router.post("/login", async (req, res) => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      return res.status(503).json({ success: false, message: "Database connection busy or unavailable." });
    }
    const { userName: rawUserName, password: rawPassword } = req.body;
    const userName = (rawUserName || "").trim();
    const password = (rawPassword || "").trim();

    if (!userName || !password) {
      return res.status(400).json({ success: false, message: "User ID and Password are required." });
    }

    console.log(`[AUTH] Attempting login for UserName: "${userName}"`);

    const result = await pool.request()
      .input("UserName", userName)
      .query(`
        SELECT 
          u.UserId, u.UserCode, u.UserName, u.UserPassword, u.FullName,
          u.FirstName, u.LastName, u.IsDisabled, u.UserGroupid,
          g.UserGroupCode AS RoleCode, g.UserGroupName AS RoleName,
          g.isActive AS IsGroupActive
        FROM [dbo].[UserMaster] u
        LEFT JOIN [dbo].[UserGroupMaster] g ON u.UserGroupid = g.UserGroupId
        WHERE u.UserName = @UserName
      `);

    if (result.recordset.length === 0) {
      console.log(`[AUTH] Login failed: UserName "${userName}" not found.`);
      return res.status(401).json({ success: false, message: "Invalid User ID or Password." });
    }

    const user = result.recordset[0];

    // ✅ VALIDATE USER STATUS
    if (user.IsDisabled === true || user.IsDisabled === 1) {
      console.log(`[AUTH] Login failed: Account disabled for user "${user.UserName}".`);
      return res.status(403).json({ success: false, message: "Your account is disabled." });
    }

    // ✅ VALIDATE USER GROUP (STRICT CHECK)
    if (!user.UserGroupid || !user.RoleCode) {
      console.log(`[AUTH] Login failed: No valid group assigned to user "${user.UserName}".`);
      return res.status(403).json({ success: false, message: "User has no valid group assigned." });
    }

    if (user.IsGroupActive === false || user.IsGroupActive === 0) {
      console.log(`[AUTH] Login failed: User group is inactive for user "${user.UserName}".`);
      return res.status(403).json({ success: false, message: "Your user group is currently inactive." });
    }

    const dbPassword = (user.UserPassword || "").trim();
    let isValid = false;
    let needsRehash = false;

    // 1. Try bcrypt check
    try {
      if (dbPassword.startsWith("$2a$") || dbPassword.startsWith("$2b$")) {
        isValid = await bcrypt.compare(password, dbPassword);
      }
    } catch (e) {
      console.error("Bcrypt compare error:", e);
    }

    // 2. Legacy check fallback
    if (!isValid) {
      const parts = dbPassword.split("-");
      const candidates = [dbPassword, parts[0]].filter(c => c.length > 0);

      for (const cand of candidates) {
        if (cand === password) { isValid = true; needsRehash = true; break; }
        try {
          const decoded = Buffer.from(cand, "base64").toString("utf-8").trim();
          if (decoded === password) { isValid = true; needsRehash = true; break; }
        } catch (e) {}
      }
    }

    if (!isValid) {
      console.log(`[AUTH] Login failed: Password mismatch for user "${user.UserName}".`);
      return res.status(401).json({ success: false, message: "Invalid User ID or Password." });
    }

    // Auto-migrate legacy password to bcrypt
    if (needsRehash) {
      try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.request()
          .input("UserId", user.UserId)
          .input("HashedPassword", hashedPassword)
          .query("UPDATE [dbo].[UserMaster] SET UserPassword = @HashedPassword WHERE UserId = @UserId");
        console.log(`[AUTH] Successfully migrated password to bcrypt for user "${user.UserName}".`);
      } catch (e) {
        console.error(`[AUTH] Failed to migrate password to bcrypt for user "${user.UserName}":`, e);
      }
    }

    // Update Last Login
    await pool.request()
      .input("UserId", user.UserId)
      .query("UPDATE [dbo].[UserMaster] SET LastLogInDate = GETDATE() WHERE UserId = @UserId");

    const finalUserId = String(user.UserId).trim();
    const roleCode = (user.RoleCode || "CASHIER").toUpperCase().trim();

    // 1. Generate Security Token (JWT)
    const token = jwt.sign(
      { userId: finalUserId, role: roleCode },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log(`✅ Login Success: ${user.FullName} | Role: ${roleCode}`);

    // 2. Return Comprehensive Auth Response
    return res.json({
      success: true,
      token,
      user: {
        userId: finalUserId,
        id: finalUserId,
        userCode: user.UserCode,
        userName: user.UserName,
        fullName: user.FullName || user.FirstName,
        role: roleCode, // ADMIN, CASHIER, WAITER, etc.
        roleName: user.RoleName,
        userGroupId: user.UserGroupid
      }
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/* ================= AUTH - VERIFY PASSWORD (ROLE-BASED) ================= */
router.post("/verify", async (req, res) => {
  try {
    const { password, role } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, message: "Missing password" });
    }

    const pool = await poolPromise;
    const base64Password = Buffer.from(password).toString("base64");

    let query = `
      SELECT u.UserId, u.UserPassword, u.UserName 
      FROM [dbo].[UserMaster] u
      INNER JOIN [dbo].[UserGroupMaster] g ON u.UserGroupid = g.UserGroupId
      WHERE (u.IsDisabled IS NULL OR u.IsDisabled = 0)
        AND g.isActive = 1
    `;

    const request = pool.request();

    if (role) {
      let roleList = [];
      if (Array.isArray(role)) {
        roleList = role.map(r => String(r).toUpperCase().trim());
      } else if (typeof role === 'string') {
        roleList = role.split(',').map(r => r.toUpperCase().trim());
      }

      if (roleList.length > 0) {
        const conditions = [];
        roleList.forEach((r, idx) => {
          const paramName = `role_${idx}`;
          request.input(paramName, sql.VarChar, r);
          conditions.push(`UPPER(g.UserGroupCode) = @${paramName} OR UPPER(g.UserGroupName) = @${paramName}`);
        });
        query += ` AND (${conditions.join(' OR ')})`;
      }
    }

    const result = await request.query(query);

    let isValid = false;
    let matchedUser = null;
    let needsRehash = false;

    for (const u of result.recordset) {
      const dbPassword = (u.UserPassword || "").trim();
      
      // Try bcrypt check
      if (dbPassword.startsWith("$2a$") || dbPassword.startsWith("$2b$")) {
        try {
          if (await bcrypt.compare(password, dbPassword)) {
            isValid = true;
            matchedUser = u;
            break;
          }
        } catch (e) {}
      } else {
        // Try legacy check
        const parts = dbPassword.split("-");
        const candidates = [dbPassword, parts[0]].filter(c => c.length > 0);

        for (const cand of candidates) {
          if (cand === password || Buffer.from(cand, "base64").toString("utf-8").trim() === password) {
            isValid = true;
            matchedUser = u;
            needsRehash = true;
            break;
          }
        }
        if (isValid) break;
      }
    }

    // Auto-migrate legacy password to bcrypt during verification
    if (isValid && needsRehash && matchedUser) {
      try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.request()
          .input("UserId", matchedUser.UserId)
          .input("HashedPassword", hashedPassword)
          .query("UPDATE [dbo].[UserMaster] SET UserPassword = @HashedPassword WHERE UserId = @UserId");
        console.log(`[AUTH] Successfully migrated password to bcrypt for user "${matchedUser.UserName}" during verification.`);
      } catch (e) {
        console.error(`[AUTH] Failed to migrate password to bcrypt during verification:`, e);
      }
    }

    return res.json({ success: isValid });
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(500).json({ success: false });
  }
});

// 🚀 PERMISSIONS CACHE (5-minute TTL)
const permissionCache = new Map();
const PERM_CACHE_TTL = 5 * 60 * 1000;

/* ================= AUTH - PERMISSIONS ================= */
router.get("/permissions/:userGroupCode", async (req, res) => {
  try {
    const { userGroupCode } = req.params;
    const cacheKey = (userGroupCode || "").trim().toUpperCase();

    if (!cacheKey) {
      return res.status(400).json({ error: "Invalid user group code" });
    }

    // Check memory cache
    const cached = permissionCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < PERM_CACHE_TTL)) {
      console.log(`⚡ [Permissions Cache] Hit for group: ${cacheKey}`);
      return res.json(cached.data);
    }

    console.log(`🔎 [Permissions Cache] Miss for group: ${cacheKey}. Fetching from DB...`);
    const pool = await poolPromise;
    const result = await pool.request()
      .input("UserGroupCode", cacheKey)
      .query(`
        SELECT 
          LTRIM(RTRIM(FormCode)) AS FormCode,
          LTRIM(RTRIM(AllowAdd))    AS AllowAdd,
          LTRIM(RTRIM(AllowUpdate)) AS AllowUpdate,
          LTRIM(RTRIM(AllowDelete)) AS AllowDelete,
          LTRIM(RTRIM(AllowRead))   AS AllowRead
        FROM [dbo].[UserPermission]
        WHERE UserGroupCode = @UserGroupCode
      `);

    const permMap = {};
    for (const row of result.recordset) {
      if (row.FormCode) {
        permMap[row.FormCode] = {
          canAdd:    row.AllowAdd    === "A",
          canUpdate: row.AllowUpdate === "U",
          canDelete: row.AllowDelete === "D",
          canRead:   row.AllowRead   === "R",
        };
      }
    }

    // Save to cache
    permissionCache.set(cacheKey, {
      data: permMap,
      timestamp: Date.now()
    });

    res.json(permMap);
  } catch (err) {
    console.error("PERMISSIONS FETCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= AUTH - CHANGE PASSWORD ================= */
router.post("/change-password", async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    const pool = await poolPromise;
    const userRes = await pool.request()
      .input("UserId", sql.NVarChar, userId)
      .query("SELECT * FROM [dbo].[UserMaster] WHERE UserId = @UserId");

    if (userRes.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Hash new password and save it directly
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await pool.request()
      .input("UserId", userId)
      .input("HashedPassword", hashedNewPassword)
      .query("UPDATE [dbo].[UserMaster] SET UserPassword = @HashedPassword WHERE UserId = @UserId");

    res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    console.error("CHANGE PASSWORD ERROR:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
