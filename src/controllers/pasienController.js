const pool = require('../config/db');

// 1. Tampilkan Daftar Pasien
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

        // ==========================================
        // [BARU] MENGAMBIL DATA NAGARI DAN JORONG UNTUK FILTER
        // ==========================================
        // Ambil data nagari
        const nagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');
        
        // Ambil data jorong beserta nama nagarinya (menggunakan JOIN)
        const jorong = await pool.query(`
            SELECT j.*, n.nama_nagari 
            FROM jorong j 
            JOIN nagari n ON j.id_nagari = n.id_nagari 
            ORDER BY j.nama_jorong ASC
        `);

        // Render ke halaman EJS
        res.render('kader/pasien', { 
            daftarPasien: result.rows,
            nagari: nagari.rows,   // [BARU] Kirim data nagari ke halaman pasien.ejs
            jorong: jorong.rows,   // [BARU] Kirim data jorong ke halaman pasien.ejs
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
    try {
        // 1. Ambil data dari form EJS
        const { id_jorong, nik, nama_pasien, usia, jenis_kelamin, alamat, no_hp, pekerjaan, agama } = req.body;

        // ==========================================
        // 2. JURUS PAMUNGKAS: BIKIN ID OTOMATIS!
        // Membuat ID unik berdasarkan waktu saat ini agar tidak akan pernah duplikat
        // ==========================================
        const id_pasien = nik; 

        // 3. Kalkulator Tahun Lahir
        const tahunSekarang = new Date().getFullYear();
        const tahun_lahir = tahunSekarang - parseInt(usia);

        // 4. Query SQL (Kita masukkan kembali id_pasien di urutan PERTAMA)
        const query = `
            INSERT INTO pasien (id_pasien, id_jorong, nik, nama_pasien, usia, tahun_lahir, jenis_kelamin, alamat, no_hp, pekerjaan, agama) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `;
        
        // 5. Susunan data (id_pasien di urutan paling depan sesuai $1)
        const values = [id_pasien, id_jorong, nik, nama_pasien, usia, tahun_lahir, jenis_kelamin, alamat, no_hp, pekerjaan, agama];

        // 6. Eksekusi ke Database
        await pool.query(query, values);
        
        // 7. Jika sukses, kembali ke halaman pasien
        res.redirect('/pasien');

    } catch (err) {
        console.error("ERROR SAAT SIMPAN PASIEN:", err); 
        res.status(500).send("<script>alert('Gagal menambah pasien. Cek terminal untuk detailnya.'); window.history.back();</script>");
    }
};


