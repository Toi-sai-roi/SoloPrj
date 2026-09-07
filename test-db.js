require('dotenv').config();
const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL || process.argv[2],
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000
});

console.log('Đang thử connect...');
const start = Date.now();

client.connect()
  .then(() => {
    console.log(`✅ Connect thành công sau ${Date.now() - start}ms`);
    return client.query('SELECT NOW()');
  })
  .then((res) => {
    console.log('✅ Query thành công:', res.rows[0]);
    return client.end();
  })
  .catch((err) => {
    console.log(`❌ Lỗi sau ${Date.now() - start}ms:`, err.message);
    process.exit(1);
  });