const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

(async () => {
    try {
        const defaultHash = await bcrypt.hash('123456', 10);
        
        // Reset password untuk bidan_sari dan kader_ani agar seragam menggunakan '123456'
        await pool.query('UPDATE "user" SET password = $1 WHERE username IN (\'bidan_sari\', \'kader_ani\')', [defaultHash]);
        
        console.log('✅ Password untuk bidan_sari dan kader_ani berhasil direset menjadi: 123456');
        process.exit(0);
    } catch (err) {
        console.error('❌ Gagal reset password:', err);
        process.exit(1);
    }
})();
