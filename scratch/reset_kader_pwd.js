const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

(async () => {
  try {
    const res = await pool.query("SELECT password FROM \"user\" WHERE username = 'kader_ani'");
    if (res.rows.length === 0) {
      console.log('No user found');
      process.exit(1);
    }
    const oldHash = res.rows[0].password;
    console.log(`OLD_HASH: ${oldHash}`);
    
    const newHash = await bcrypt.hash('Password123!', 10);
    await pool.query("UPDATE \"user\" SET password = $1 WHERE username = 'kader_ani'", [newHash]);
    console.log('Updated password to: Password123!');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
