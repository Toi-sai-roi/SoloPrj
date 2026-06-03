const { query } = require('./config/db');

async function fix() {
  try {
    await query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT');
    console.log('✅ Added media_url column to messages table');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

fix();