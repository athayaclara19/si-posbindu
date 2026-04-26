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
    
    // HAPUS/KOMENTARI BARIS INI KARENA KITA SUDAH AMBIL DARI FORM:
    // const id_jorong = req.session.user.id_jorong; 
    
    const id_pasien = 'PAS-' + Date.now(); // Generate ID unik

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