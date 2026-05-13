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


 //4. Memproses Hapus Data Pasien
exports.handleDeletePasien = async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Hapus semua riwayat skrining
        await pool.query('DELETE FROM skrining WHERE id_pasien = $1', [id]);
        
        // 2. Hapus data induknya (pasien)
        await pool.query('DELETE FROM pasien WHERE id_pasien = $1', [id]);
        
        // [DIUBAH] Ambil ulang data dan render halaman dengan membawa successMessage
        const query = `
            SELECT p.*, j.nama_jorong 
            FROM pasien p 
            JOIN jorong j ON p.id_jorong = j.id_jorong 
            ORDER BY p.nama_pasien ASC
        `;
        const result = await pool.query(query);

        res.render('ptm/kelolapasien', { 
            pasien: result.rows,
            active: 'pasien',
            successMessage: 'Data pasien beserta riwayatnya berhasil dihapus permanen!' // [BARU] Pesan sukses
        });
    } catch (err) {
        console.error("ERROR DELETE PASIEN:", err);
        // ... (kode error tangkapan catch tetap sama seperti sebelumnya)
        try {
            const query = `SELECT p.*, j.nama_jorong FROM pasien p JOIN jorong j ON p.id_jorong = j.id_jorong ORDER BY p.nama_pasien ASC`;
            const result = await pool.query(query);
            res.render('ptm/kelolapasien', { 
                pasien: result.rows,
                active: 'pasien',
                errorMessage: 'Gagal menghapus! Pastikan tidak ada data lain yang terkait dengan pasien ini.' 
            });
        } catch (fetchErr) {
            res.status(500).send("Terjadi kesalahan sistem.");
        }
    }
};

/**
 * 5. Menampilkan Halaman Dashboard PTM
 */
exports.renderDashboardPTM = async (req, res) => {
    try {
        const tahunIni = new Date().getFullYear();
        
        // Asumsi Target Tahunan Puskesmas adalah 2000
        const TARGET_TAHUNAN = 2000;
        
        // Target spesifik per Nagari (sesuaikan dengan nama Nagari di Database kamu)
        const targetNagari = {
            'Sungai Tarab': 500,
            'Baringin': 450,
            'Salimpaung': 400,
            'Tigo Jangko': 350,
            'Guguak': 300
        };

        // 1. Total Skrining Tahun Ini (Capaian)
        const qCapaian = `
            SELECT COUNT(DISTINCT s.id_pasien) as total_tercapai
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
        `;
        const resCapaian = await pool.query(qCapaian, [tahunIni]);
        const totalTercapai = parseInt(resCapaian.rows[0].total_tercapai) || 0;
        const sisaTarget = Math.max(0, TARGET_TAHUNAN - totalTercapai);
        const persenTarget = Math.round((totalTercapai / TARGET_TAHUNAN) * 100);

        // 2. Metrik Hipertensi & Terkendali (Tahun Ini)
        const qMetrik = `
            SELECT 
                COUNT(DISTINCT CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN s.id_pasien END) as hipertensi,
                COUNT(DISTINCT CASE WHEN s.sistole < 140 AND s.diastole < 90 THEN s.id_pasien END) as terkendali
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
        `;
        const resMetrik = await pool.query(qMetrik, [tahunIni]);
        const totalHipertensi = parseInt(resMetrik.rows[0].hipertensi) || 0;
        const totalTerkendali = parseInt(resMetrik.rows[0].terkendali) || 0;
        const persenHipertensi = totalTercapai > 0 ? ((totalHipertensi / totalTercapai) * 100).toFixed(1) : 0;
        const persenTerkendali = totalTercapai > 0 ? ((totalTerkendali / totalTercapai) * 100).toFixed(1) : 0;

        // 3. Capaian per Nagari
        const qNagari = `
            SELECT 
                n.nama_nagari,
                COUNT(DISTINCT s.id_pasien) as capaian
            FROM nagari n
            LEFT JOIN jorong j ON n.id_nagari = j.id_nagari
            LEFT JOIN pasien p ON j.id_jorong = p.id_jorong
            LEFT JOIN skrining s ON p.id_pasien = s.id_pasien AND s.status_validasi = 'terverifikasi'
            LEFT JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan AND EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
            GROUP BY n.nama_nagari
            ORDER BY capaian DESC
        `;
        const resNagari = await pool.query(qNagari, [tahunIni]);
        
        // Format data gabungan dengan target
        const dataNagari = resNagari.rows.map(row => {
            const target = targetNagari[row.nama_nagari] || 400; // Default 400 jika nama tidak cocok
            const capaian = parseInt(row.capaian) || 0;
            return {
                nama_nagari: row.nama_nagari,
                capaian: capaian,
                target: target,
                persentase: Math.round((capaian / target) * 100)
            };
        });

        // Lempar ke EJS
        res.render('ptm/dashboardptm', {
            active: 'dashboard',
            tahunIni,
            TARGET_TAHUNAN,
            totalTercapai,
            sisaTarget,
            persenTarget,
            totalHipertensi,
            persenHipertensi,
            persenTerkendali,
            dataNagari
        });

    } catch (err) {
        console.error("ERROR RENDER DASHBOARD PTM:", err);
        res.status(500).send("Gagal memuat dashboard PTM.");
    }
};