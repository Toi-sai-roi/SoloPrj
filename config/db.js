// ==========================================
// config/db.js — PostgreSQL Configuration
// v9.1-fix: #11 Guard DB_PASSWORD check cả DATABASE_URL
// ==========================================
const { Pool } = require('pg');
require('dotenv').config();

// FIX #11: Guard phải check cả DATABASE_URL
if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: DB_PASSWORD must be set in production');
}

let poolConfig;

if (process.env.DATABASE_URL) {
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  };
} else {
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'cyberpunk_chat',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  };
}

poolConfig = {
  ...poolConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('❌ PostgreSQL connection test failed:', err.message);
  } else {
    console.log('✅ PostgreSQL connection test passed');
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool
};
