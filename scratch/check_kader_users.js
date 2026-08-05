const pool = require('../src/config/db');
(async () => {
  try {
    const res = await pool.query("SELECT username, nama_user, role FROM \"user\" WHERE role = 'kader'");
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
