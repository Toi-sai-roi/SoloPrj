const { query } = require('./config/db');

async function check() {
  const result = await query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'friends'
  `);
  console.log(result.rows);
  process.exit(0);
}

check();