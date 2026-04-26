const bcrypt = require('bcryptjs');
const pool = require('./src/config/db'); // Pastikan path ini mengarah ke file db.js kamu

async function resetPassword() {
    try {
        console.log("Membuat hash baru untuk '123456'...");
        // Bikin hash asli dari library bcryptjs kamu sendiri
        const hashBaru = await bcrypt.hash('123456', 10); 
        
        console.log("Menyimpan ke database...");
        // Update semua user di database
        await pool.query('UPDATE "user" SET password = $1', [hashBaru]);
        
        console.log("✅ BERHASIL! Semua password user sekarang adalah: 123456");
        process.exit(); // Matikan script
    } catch (err) {
        console.error("❌ Gagal:", err);
        process.exit(1);
    }
}

resetPassword();