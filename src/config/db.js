// ============================================================
// FILE: src/config/db.js
// Fungsi: Membuat koneksi ke PostgreSQL menggunakan "Pool"
//
// Kenapa Pool, bukan Client biasa?
// Pool mengelola banyak koneksi sekaligus. Bayangkan seperti
// antrian kasir: Pool menyediakan beberapa kasir (koneksi) agar
// tidak ada antrian panjang saat banyak user request sekaligus.
// ============================================================

const { Pool } = require('pg');
require('dotenv').config(); // Memuat semua variabel dari file .env

const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

// Test koneksi saat server pertama kali dijalankan
// Ini seperti "ping" ke database untuk memastikan konfigurasi benar
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ GAGAL terhubung ke PostgreSQL:', err.stack);
        return;
    }
    console.log('✅ Berhasil terhubung ke PostgreSQL!');
    release(); // Kembalikan koneksi ke Pool setelah test selesai
});

// Ekspor pool agar bisa digunakan di seluruh file Controller
module.exports = pool;
