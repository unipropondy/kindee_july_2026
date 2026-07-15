const { poolPromise, sql } = require("../config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    console.log("Testing UPDATE MemberMaster CurrentBalance...");
    await transaction.request()
      .input("MemberId", sql.UniqueIdentifier, "2EB4F59E-A26C-4128-8160-7EF23A164364")
      .input("Amount", sql.Decimal(18, 2), 1.64)
      .query("UPDATE MemberMaster SET CurrentBalance = CurrentBalance + @Amount WHERE MemberId = @MemberId");
    
    console.log("UPDATE succeeded!");
    
    console.log("Testing INSERT INTO CustomerCreditTransactions...");
    await transaction.request()
      .input("MemberId", sql.UniqueIdentifier, "2EB4F59E-A26C-4128-8160-7EF23A164364")
      .input("SettlementId", sql.UniqueIdentifier, "A1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D")
      .input("BillNo", sql.NVarChar(50), "TEST-BILL-123")
      .input("Amount", sql.Decimal(18, 2), 1.64)
      .input("CreatedBy", sql.UniqueIdentifier, "8C026364-77E7-4002-803B-9BBE187C60BD")
      .query(`
        INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy, CustomerType)
        VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @Amount, 0, @Amount, 'OPEN', 'Split member credit purchase', @CreatedBy, 'MEMBER')
      `);
      
    console.log("INSERT succeeded!");
    
    await transaction.rollback();
    console.log("Rollback successful. Test passed!");
  } catch (err) {
    console.error("Test failed with error:", err);
  }
  process.exit(0);
}

run();
