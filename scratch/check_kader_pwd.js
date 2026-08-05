const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

(async () => {
  try {
    const res = await pool.query("SELECT password FROM \"user\" WHERE username = 'kader_ani'");
    if (res.rows.length === 0) {
      console.log('No user found');
      process.exit(1);
    }
    const hash = res.rows[0].password;
    const candidates = ['password', 'Password123!', 'kader_ani', '123456', 'kaderani', 'admin'];
    for (const c of candidates) {
      const match = await bcrypt.compare(c, hash);
      if (match) {
        console.log(`FOUND PWD: ${c}`);
        process.exit(0);
      }
    }
    console.log('No match found');
    process.exit(1);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
