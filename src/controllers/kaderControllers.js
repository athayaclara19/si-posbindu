const pool = require('../config/db');

// 1. Tampilkan Form Input Skrining Baru
exports.renderInputSkrining = async (req, res) => {
    try {
        const pasien = await pool.query('SELECT id_pasien, nama_pasien, nik FROM pasien');
        const kegiatan = await pool.query('SELECT id_kegiatan, lokasi, tanggal_kegiatan FROM kegiatan');
        
        res.render('kader/skrining', { 
            pasien: pasien.rows, 
            kegiatan: kegiatan.rows,
            error: null 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat data form");
    }
};

// 2. Proses Simpan Data (POST)
exports.handleInputSkrining = async (req, res) => {
    const { id_pasien, id_kegiatan, sistole, diastole, berat_badan, tinggi_badan } = req.body;
    const id_kader = req.session.user.id; // Diambil dari session login

    // --- LOGIKA DSS SEDERHANA ---
    let status_tekanan = 'Terkendali';
    if (parseInt(sistole) >= 140 || parseInt(diastole) >= 90) {
        status_tekanan = 'Tidak Terkendali';
    }

    try {
        const query = `
            INSERT INTO skrining 
            (id_pasien, id_kader, id_kegiatan, sistole, diastole, berat_badan, tinggi_badan, status_tekanan, status_validasi) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'menunggu')
        `;
        await pool.query(query, [id_pasien, id_kader, id_kegiatan, sistole, diastole, berat_badan, tinggi_badan, status_tekanan]);
        
        res.redirect('/riwayat'); // Redirect ke halaman riwayat setelah berhasil
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menyimpan data skrining");
    }
};

// 3. Tampilkan Halaman Riwayat Skrining
exports.renderRiwayat = async (req, res) => {
    const id_kader = req.session.user.id; // Ambil ID kader yang sedang login

    try {
        // Query untuk mengambil data skrining milik kader ini, digabung dengan nama pasien dan tanggal kegiatan
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, k.tanggal_kegiatan 
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.id_kader = $1
            ORDER BY k.tanggal_kegiatan DESC
        `;
        const result = await pool.query(query, [id_kader]);

        res.render('kader/riwayat', { 
            riwayat: result.rows,
            active: 'riwayat' 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat riwayat skrining");
    }
};

// =========================================================
// FUNGSI BARU: UNTUK EDIT DATA YANG DIREVISI BIDAN
// =========================================================

// 4. Tampilkan Form Edit Skrining (Khusus yang Perlu Revisi)
exports.renderEditSkrining = async (req, res) => {
    const { id_skrining } = req.params;
    
    try {
        const query = `
            SELECT s.*, p.nama_pasien, p.nik 
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            WHERE s.id_skrining = $1 AND s.status_validasi = 'revisi'
        `;
        const result = await pool.query(query, [id_skrining]);

        if (result.rows.length === 0) {
            return res.status(404).send("Data tidak ditemukan atau tidak dalam status revisi.");
        }

        res.render('kader/edit_skrining', { 
            skrining: result.rows[0],
            active: 'riwayat' // Biarkan highlight di sidebar tetap di Riwayat
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat form edit.");
    }
};

// 5. Proses Simpan Hasil Edit
exports.handleEditSkrining = async (req, res) => {
    const { id_skrining } = req.params;
    const { sistole, diastole, berat_badan, tinggi_badan, gula_darah, kolesterol } = req.body;

    // Logika Penentuan Status Hipertensi (Sama seperti saat input baru)
    let status_tekanan = "Normal";
    if (parseInt(sistole) >= 140 || parseInt(diastole) >= 90) {
        status_tekanan = "Tidak Terkendali";
    } else if (parseInt(sistole) >= 120 || parseInt(diastole) >= 80) {
        status_tekanan = "Prehipertensi";
    } else {
        status_tekanan = "Terkendali";
    }

    try {
        const query = `
            UPDATE skrining 
            SET sistole = $1, diastole = $2, berat_badan = $3, tinggi_badan = $4, 
                gula_darah = $5, kolesterol = $6, status_tekanan = $7, 
                status_validasi = 'menunggu' 
            WHERE id_skrining = $8
        `;
        const values = [sistole, diastole, berat_badan || null, tinggi_badan || null, gula_darah || null, kolesterol || null, status_tekanan, id_skrining];
        
        await pool.query(query, values);
        
        // Kembalikan Kader ke halaman Riwayat setelah sukses edit
        res.redirect('/riwayat');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menyimpan perubahan skrining.");
    }
};