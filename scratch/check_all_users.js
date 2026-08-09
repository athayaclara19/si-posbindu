const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

(async () => {
    try {
        const users = await pool.query('SELECT id_user, username, nama_user, role, is_active, password FROM "user"');
        for (let u of users.rows) {
            console.log(`User: ${u.username} (${u.nama_user}) | Role: ${u.role} | Active: ${u.is_active}`);
            const common = ['password', '123456', 'Password123!', u.username, 'admin', 'kader123', 'bidan123', 'posbindu', '12345678', 'password123'];
            let found = false;
            for (let p of common) {
                if (await bcrypt.compare(p, u.password)) {
                    console.log(`   -> Password cocok: "${p}"`);
                    found = true;
                    break;
                }
            }
            if (!found) {
                console.log(`   -> Password tidak cocok dengan list tebakan umum. Hash: ${u.password.substring(0, 15)}...`);
            }
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
