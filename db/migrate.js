// ==========================================
// db/migrate.js — PostgreSQL Schema Migration
// ==========================================
const { pool } = require('../config/db');

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username      VARCHAR(30) PRIMARY KEY,
        password_hash VARCHAR(128) NOT NULL,
        salt          VARCHAR(32) NOT NULL,
        avatar        TEXT DEFAULT '',
        bio           VARCHAR(100) DEFAULT '',
        last_seen     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id        SERIAL PRIMARY KEY,
        sender    VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        receiver  VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        text      TEXT NOT NULL,
        media_url TEXT DEFAULT '',
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        delivered BOOLEAN DEFAULT FALSE,
        read_at   TIMESTAMPTZ,
        CONSTRAINT no_self_message CHECK (sender != receiver)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation 
      ON messages(sender, receiver, timestamp DESC)
    `);

    // Blocks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id          SERIAL PRIMARY KEY,
        blocker     VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        blocked     VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(blocker, blocked)
      )
    `);

    // Reactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reactions (
        id         SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        username   VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        emoji      VARCHAR(10) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, username)
      )
    `);

    // Friends table
    await client.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id         SERIAL PRIMARY KEY,
        user_one   VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        user_two   VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        status     VARCHAR(20) DEFAULT 'pending',
        sender     VARCHAR(30) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_one, user_two)
      )
    `);

    // Groups table
    await client.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        avatar      TEXT DEFAULT '',
        description VARCHAR(200) DEFAULT '',
        created_by  VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Group members table
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        username    VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        role        VARCHAR(20) DEFAULT 'member',
        joined_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, username)
      )
    `);

    // Group messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_messages (
        id        SERIAL PRIMARY KEY,
        group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        sender    VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        text      TEXT NOT NULL,
        media_url TEXT DEFAULT '',
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Group reactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_reactions (
        id         SERIAL PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
        username   VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        emoji      VARCHAR(10) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, username)
      )
    `);

    // Media uploads table
    await client.query(`
      CREATE TABLE IF NOT EXISTS media_uploads (
        id         SERIAL PRIMARY KEY,
        filename   VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        mime_type  VARCHAR(50),
        size       INTEGER,
        uploaded_by VARCHAR(30) REFERENCES users(username) ON DELETE SET NULL,
        url        TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query('COMMIT');
    console.log('✅ PostgreSQL migration completed successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate().catch(console.error).finally(() => pool.end());