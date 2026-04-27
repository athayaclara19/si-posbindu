const pool = require('../config/db');

// 1. Tampilkan Daftar Pasien
exports.renderDaftarPasien = async (req, res) => {
    try {
        // HAPUS filter "WHERE p.id_jorong = $1" agar Kader bisa melihat SEMUA pasien.
        // UBAH urutan menjadi DESC (Descending) agar pasien yang baru ditambah 
        // langsung muncul di baris paling atas tabel!
        
        const query = `
            SELECT p.*, j.nama_jorong 
            FROM pasien p 
            JOIN jorong j ON p.id_jorong = j.id_jorong 
            ORDER BY p.id_pasien DESC 
        `;
        const result = await pool.query(query);

        res.render('kader/pasien', { 
            daftarPasien: result.rows,
            active: 'pasien' 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat daftar pasien");
    }
};

// 2. Tampilkan Form Tambah Pasien
exports.renderTambahPasien = async (req, res) => {
    try {
        // Asumsi kamu memiliki tabel 'nagari' dan kolom 'id_nagari' di tabel 'jorong'
        const nagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');
        const jorong = await pool.query('SELECT * FROM jorong ORDER BY nama_jorong ASC');
        
        res.render('kader/tambah_pasien', { 
            nagari: nagari.rows,
            jorong: jorong.rows, // Kirim semua jorong, nanti kita filter pakai JavaScript di EJS
            active: 'pasien'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat form tambah pasien");
    }
};

// 3. Proses Simpan Pasien Baru
exports.handleTambahPasien = async (req, res) => {
    // TAMBAHKAN id_jorong DI SINI 👇
    const { nik, nama_pasien, id_jorong, tanggal_lahir, jenis_kelamin, alamat, no_hp, pekerjaan, agama } = req.body;
    
    // --- LOGIKA AUTO-INCREMENT ID PASIEN (PAS001, PAS002, dst) ---
    let id_pasien = 'PAS001'; // Default jika tabel pasien masih kosong
    
    // Cari ID Pasien terakhir yang berawalan 'PAS'
    const lastPasienResult = await pool.query(
        "SELECT id_pasien FROM pasien WHERE id_pasien LIKE 'PAS%' ORDER BY id_pasien DESC LIMIT 1"
    );

    if (lastPasienResult.rows.length > 0) {
        const lastId = lastPasienResult.rows[0].id_pasien; // Contoh: 'PAS002'
        const lastNumber = parseInt(lastId.substring(3));  // Mengambil angka '002' menjadi 2
        const nextNumber = lastNumber + 1;                 // 2 + 1 = 3
        id_pasien = 'PAS' + String(nextNumber).padStart(3, '0'); // Menggabungkan jadi 'PAS003'
    }
    // -----------------------------------------------------------

    try {
        const query = `
            INSERT INTO pasien 
            (id_pasien, id_jorong, nik, nama_pasien, tanggal_lahir, jenis_kelamin, alamat, no_hp, pekerjaan, agama) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;
        const values = [id_pasien, id_jorong, nik, nama_pasien, tanggal_lahir, jenis_kelamin, alamat, no_hp, pekerjaan, agama];
        
        await pool.query(query, values);
        res.redirect('/pasien'); // Kembali ke daftar pasien
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menyimpan data pasien baru. Pastikan NIK tidak duplikat!");
    }
};