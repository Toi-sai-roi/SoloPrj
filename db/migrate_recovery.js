// ==========================================
// db/migrate_recovery_code_v2.js — Switch recovery_code_hash to plaintext recovery_code
// ==========================================
const { pool } = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS recovery_code_hash`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code VARCHAR(20)`);

    await client.query('COMMIT');
    console.log('✅ Recovery code migration completed');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

migrate().catch(console.error);
