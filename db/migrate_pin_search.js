// ==========================================
// db/migrate_pin_search.js — Add pinned_messages table
// ==========================================
const { pool } = require('../config/db');

async function migratePinSearch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Pinned messages table — 1 tin pinned per conversation
    await client.query(`
      CREATE TABLE IF NOT EXISTS pinned_messages (
        id          SERIAL PRIMARY KEY,
        user1       VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        user2       VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        pinned_by   VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        pinned_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user1, user2)
      )
    `);

    // Index for fast lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pinned_messages_lookup 
      ON pinned_messages(user1, user2)
    `);

    // Full-text search index on messages (optional but good for performance)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_text_search 
      ON messages USING gin(to_tsvector('simple', text))
    `);

    await client.query('COMMIT');
    console.log('✅ Pin & Search migration completed');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Pin & Search migration failed:', err);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

migratePinSearch().catch(console.error);