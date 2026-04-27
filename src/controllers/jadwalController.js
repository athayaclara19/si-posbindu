const pool = require('../config/db');

// Untuk KADER: hanya lihat jadwal
exports.renderJadwalKader = async (req, res) => {
    try {
        const query = `
            SELECT k.*, j.nama_jorong, p.periode_bulan, p.periode_tahun
            FROM kegiatan k
            JOIN jorong j  ON k.id_jorong = j.id_jorong
            JOIN periode p ON k.id_periode = p.periode_id
            ORDER BY k.tanggal_kegiatan ASC
        `;
        const result = await pool.query(query);
        res.render('kader/jadwal', { jadwal: result.rows, active: 'jadwal' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat jadwal: " + err.message);
    }
};