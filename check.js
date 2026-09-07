require('dotenv').config();
require('./config/db').query("SELECT column_name FROM information_schema.columns WHERE table_name='users'")
  .then(r => { console.log(r.rows); process.exit(); });