const pool      = require('../config/db');
const { analisaTensiPasien } = require('../utils/dssHelper');

// Daftar pasien + status terkendali
exports.renderMonitoring = async (req, res) => {
    try {
        const query = `
            SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
            MAX(s.tanggal_skrining)        AS kunjungan_terakhir,
            (SELECT s2.sistole FROM skrining s2 
             WHERE s2.id_pasien=p.id_pasien AND s2.status_validasi='terverifikasi'
             ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS sistole_terakhir,
            (SELECT s2.diastole FROM skrining s2 
             WHERE s2.id_pasien=p.id_pasien AND s2.status_validasi='terverifikasi'
             ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS diastole_terakhir
            FROM pasien p
            JOIN jorong j ON p.id_jorong = j.id_jorong
            LEFT JOIN skrining s ON s.id_pasien = p.id_pasien
            GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
            ORDER BY p.nama_pasien ASC
        `;
        const result = await pool.query(query);
        res.render('bidan/monitoring', { daftarPasien: result.rows, active: 'monitoring' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat monitoring.");
    }
};

// DSS — Grafik histori tensi satu pasien
exports.renderGrafikTensi = async (req, res) => {
    const { id_pasien } = req.params;
    try {
        const pasien = await pool.query('SELECT * FROM pasien WHERE id_pasien=$1', [id_pasien]);
        const riwayat = await pool.query(`
            SELECT sistole, diastole, tanggal_skrining
            FROM skrining
            WHERE id_pasien=$1 AND status_validasi='terverifikasi'
            ORDER BY tanggal_skrining ASC
        `, [id_pasien]);
        const historiSistole = riwayat.rows.map(r => r.sistole);
        const analisa = analisaTensiPasien(historiSistole);
        res.render('bidan/monitoring', { 
            pasienTerpilih: pasien.rows[0],
            riwayatTensi:   riwayat.rows,
            analisa, active: 'monitoring' 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat grafik tensi.");
    }
};