const pool = require('../src/config/db');

(async () => {
  try {
    const oldHash = '$2b$10$qkjnY.2HVOpNFBUH7y/z6OX37EvQyS81jBtH/eGyPTNpJ0vQ7JMYu';
    await pool.query("UPDATE \"user\" SET password = $1 WHERE username = 'kader_ani'", [oldHash]);
    console.log('Restored Ani\'s password hash.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
