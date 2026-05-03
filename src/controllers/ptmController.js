const pool = require('../config/db'); 

/**
 * 1. Menampilkan Halaman Daftar Pasien (Kelola Pasien)
 */
exports.renderKelolaPasien = async (req, res) => {
    try {
        // Kita ambil data pasien lengkap dengan nama jorongnya menggunakan JOIN
        const query = `
            SELECT p.*, j.nama_jorong 
            FROM pasien p 
            JOIN jorong j ON p.id_jorong = j.id_jorong 
            ORDER BY p.nama_pasien ASC
        `;
        const result = await pool.query(query);

        // Render file EJS yang nanti akan kita buat
        res.render('ptm/kelolapasien', { 
            pasien: result.rows,
            active: 'pasien' // Untuk menandai menu aktif di sidebar
        });
    } catch (err) {
        console.error("ERROR RENDER KELOLA PASIEN:", err);
        res.status(500).send("Gagal memuat daftar pasien.");
    }
};

/**
 * 2. Menampilkan Form Edit Pasien
 */
exports.renderEditPasien = async (req, res) => {
    const { id } = req.params; // Mengambil NIK/ID dari URL
    try {
        // Ambil data pasien yang mau diedit
        const resPasien = await pool.query('SELECT * FROM pasien WHERE id_pasien = $1', [id]);
        
        // Ambil juga daftar jorong untuk pilihan dropdown di form
        const resJorong = await pool.query('SELECT * FROM jorong ORDER BY nama_jorong ASC');

        if (resPasien.rows.length === 0) {
            return res.status(404).send("Data pasien tidak ditemukan.");
        }

        res.render('ptm/edit_pasien', { 
            pasien: resPasien.rows[0],
            jorong: resJorong.rows,
            active: 'pasien'
        });
    } catch (err) {
        console.error("ERROR RENDER EDIT PASIEN:", err);
        res.status(500).send("Terjadi kesalahan saat mengambil data pasien.");
    }
};

/**
 * 3. Memproses Update Data Pasien
 */
exports.handleUpdatePasien = async (req, res) => {
    // Ambil semua data yang dikirim dari form
    const { id_pasien, nik, nama_pasien, usia, jenis_kelamin, id_jorong, alamat, no_hp, pekerjaan, agama } = req.body;

    try {
        // Kalkulasi ulang tahun lahir berdasarkan usia yang baru diinput
        const tahunSekarang = new Date().getFullYear();
        const tahun_lahir = tahunSekarang - parseInt(usia);

        const query = `
            UPDATE pasien 
            SET nik = $1, nama_pasien = $2, usia = $3, tahun_lahir = $4, 
                jenis_kelamin = $5, id_jorong = $6, alamat = $7, 
                no_hp = $8, pekerjaan = $9, agama = $10
            WHERE id_pasien = $11
        `;

        const values = [nik, nama_pasien, usia, tahun_lahir, jenis_kelamin, id_jorong, alamat, no_hp, pekerjaan, agama, id_pasien];

        await pool.query(query, values);
        
        // Setelah sukses, lempar kembali ke halaman daftar pasien
        res.redirect('/ptm/pasien');

    } catch (err) {
        console.error("ERROR UPDATE PASIEN:", err);
        res.status(500).send("Gagal memperbarui data pasien.");
    }
};

/**
 * 4. Memproses Hapus Data Pasien
 */
exports.handleDeletePasien = async (req, res) => {
    const { id } = req.params;
    try {
        // Hapus pasien berdasarkan ID/NIK
        await pool.query('DELETE FROM pasien WHERE id_pasien = $1', [id]);
        
        res.redirect('/ptm/pasien');
    } catch (err) {
        console.error("ERROR DELETE PASIEN:", err);
        
        // Jika error karena Foreign Key (pasien sudah punya data skrining)
        res.status(500).send(`
            <script>
                alert('Gagal menghapus! Pasien ini sudah memiliki riwayat skrining di database.');
                window.location.href = '/ptm/pasien';
            </script>
        `);
    }
};