const { query } = require('./config/db');

async function init() {
    try {
        // Users table
        await query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(30) PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(255),
        avatar TEXT,
        bio TEXT,
        last_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Messages table
        await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        receiver VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        text TEXT,
        media_url TEXT,
        delivered BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMPTZ,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Friends table
        await query(`
      CREATE TABLE IF NOT EXISTS friends (
        user1 VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        user2 VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        since TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user1, user2)
      )
    `);

        // Blocks table
        await query(`
      CREATE TABLE IF NOT EXISTS blocks (
        blocker VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        blocked VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        since TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (blocker, blocked)
      )
    `);

        // Groups table
        await query(`
      CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        avatar TEXT,
        created_by VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Group members
        await query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        username VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, username)
      )
    `);

        // Group messages
        await query(`
      CREATE TABLE IF NOT EXISTS group_messages (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        sender VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        text TEXT,
        media_url TEXT,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Reactions
        await query(`
      CREATE TABLE IF NOT EXISTS reactions (
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        username VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        emoji VARCHAR(10) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, username)
      )
    `);

        // Group reactions
        await query(`
      CREATE TABLE IF NOT EXISTS group_reactions (
        message_id INTEGER REFERENCES group_messages(id) ON DELETE CASCADE,
        username VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        emoji VARCHAR(10) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, username)
      )
    `);

        // Media uploads
        await query(`
      CREATE TABLE IF NOT EXISTS media_uploads (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        mime_type VARCHAR(100),
        size INTEGER,
        uploaded_by VARCHAR(30) REFERENCES users(username) ON DELETE CASCADE,
        url TEXT,
        uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
        // Online users 
        await query(`
      CREATE TABLE IF NOT EXISTS online_users (
        username VARCHAR(30) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
        connected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
        console.log('✅ Database initialized');
        process.exit(0);
    } catch (err) {
        console.error('❌ Init error:', err);
        process.exit(1);
    }
}

init();