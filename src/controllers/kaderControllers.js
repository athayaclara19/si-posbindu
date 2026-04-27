const pool = require('../config/db');

// 1. Render Form Input Skrining
exports.renderInputSkrining = async (req, res) => {
    try {
        const pasien   = await pool.query('SELECT id_pasien, nama_pasien, nik FROM pasien ORDER BY nama_pasien ASC');
        const kegiatan = await pool.query('SELECT id_kegiatan, lokasi, tanggal_kegiatan FROM kegiatan ORDER BY tanggal_kegiatan DESC');
        res.render('kader/skrining', {
            pasien: pasien.rows, kegiatan: kegiatan.rows,
            error: null, active: 'skrining'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat data form skrining.");
    }
};

// 2. Proses Simpan Skrining (POST)
exports.handleInputSkrining = async (req, res) => {
    const {
        id_pasien, id_kegiatan, sistole, diastole,
        berat_badan, tinggi_badan, gula_darah, kolesterol,
        lingkar_perut, frekuensi_nadi, merokok, pola_makan,
        aktivitas_fisik, riwayat_keluarga, tingkat_stres,
        terapi_obat, kepatuhan_obat, edukasi, status_rujukan
    } = req.body;

    const id_kader = req.session.user.id_user; // PERBAIKAN: gunakan id_user

    try {
        const query = `
            INSERT INTO skrining 
            (id_pasien, id_kader, id_kegiatan, sistole, diastole, 
            berat_badan, tinggi_badan, gula_darah, kolesterol, 
            lingkar_perut, frekuensi_nadi, merokok, pola_makan, 
            aktivitas_fisik, riwayat_keluarga, tingkat_stres, 
            terapi_obat, kepatuhan_obat, edukasi, status_rujukan, 
            tanggal_skrining, status_validasi)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
            $14,$15,$16,$17,$18,$19,$20, CURRENT_DATE, 'menunggu')
        `;
        const values = [
            id_pasien, id_kader, id_kegiatan,
            parseInt(sistole), parseInt(diastole),
            berat_badan||null, tinggi_badan||null, gula_darah||null,
            kolesterol||null, lingkar_perut||null, frekuensi_nadi||null,
            merokok==='true'||merokok===true||merokok==='on',
            pola_makan||null, aktivitas_fisik||null,
            riwayat_keluarga==='true'||riwayat_keluarga==='on',
            tingkat_stres||null,
            terapi_obat==='true'||terapi_obat==='on',
            kepatuhan_obat||null, edukasi||null, status_rujukan||'tidak'
        ];
        await pool.query(query, values);
        res.redirect('/riwayat');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menyimpan data skrining: " + err.message);
    }
};

// 3. Render Dashboard Kader
exports.renderDashboard = async (req, res) => {
    const id_kader = req.session.user.id_user;
    try {
        const total    = await pool.query("SELECT COUNT(*) FROM skrining WHERE id_kader=$1", [id_kader]);
        const menunggu = await pool.query("SELECT COUNT(*) FROM skrining WHERE id_kader=$1 AND status_validasi='menunggu'", [id_kader]);
        const revisi   = await pool.query("SELECT COUNT(*) FROM skrining WHERE id_kader=$1 AND status_validasi='ditolak'", [id_kader]);
        res.render('kader/dashboard', {
            active: 'dashboard',
            totalSkrining: total.rows[0].count,
            menungguValidasi: menunggu.rows[0].count,
            perluRevisi: revisi.rows[0].count,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat dashboard.");
    }
};

// 4. Render Riwayat Skrining
exports.renderRiwayat = async (req, res) => {
    const id_kader = req.session.user.id_user; // PERBAIKAN
    try {
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, k.tanggal_kegiatan, j.nama_jorong
            FROM skrining s
            JOIN pasien p  ON s.id_pasien  = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong j  ON p.id_jorong  = j.id_jorong
            WHERE s.id_kader = $1
            ORDER BY k.tanggal_kegiatan DESC
        `;
        const result = await pool.query(query, [id_kader]);
        res.render('kader/riwayat', { riwayat: result.rows, active: 'riwayat' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat riwayat skrining.");
    }
};

// 5. Render Form Edit Skrining (untuk data yang ditolak bidan)
exports.renderEditSkrining = async (req, res) => {
    const { id_skrining } = req.params;
    try {
        const query = `
            SELECT s.*, p.nama_pasien, p.nik 
            FROM skrining s JOIN pasien p ON s.id_pasien = p.id_pasien
            WHERE s.id_skrining = $1 AND s.status_validasi = 'ditolak'
        `;
        const result = await pool.query(query, [id_skrining]);
        if (result.rows.length === 0) {
            return res.status(404).send("Data tidak ditemukan atau tidak dalam status ditolak.");
        }
        res.render('kader/edit_skrining', { skrining: result.rows[0], active: 'riwayat' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat form edit.");
    }
};

// 6. Proses Simpan Edit Skrining (POST)
exports.handleEditSkrining = async (req, res) => {
    const { id_skrining } = req.params;
    const { sistole, diastole, berat_badan, tinggi_badan, gula_darah, kolesterol } = req.body;
    try {
        const query = `
            UPDATE skrining
            SET sistole=$1, diastole=$2, berat_badan=$3, tinggi_badan=$4,
                gula_darah=$5, kolesterol=$6, status_validasi='menunggu',
                tanggal_validasi=NULL
            WHERE id_skrining=$7
        `;
        await pool.query(query, [
            parseInt(sistole), parseInt(diastole),
            berat_badan||null, tinggi_badan||null,
            gula_darah||null, kolesterol||null,
            id_skrining
        ]);
        res.redirect('/riwayat');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menyimpan perubahan: " + err.message);
    }
};