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
        res.render('bidan/monitoring', {
            daftarPasien: result.rows,
            active: 'monitoring',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'bidan'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat monitoring.");
    }
};

// DSS — Grafik histori tensi satu pasien
// DSS — Grafik histori tensi satu pasien
exports.renderGrafikTensi = async (req, res) => {
    const { id_pasien } = req.params;
    try {
        const pasien = await pool.query(
            'SELECT * FROM pasien WHERE id_pasien=$1',
            [id_pasien]
        );

        // ✅ GANTI QUERY LAMA INI:
        // const riwayat = await pool.query(`
        //     SELECT sistole, diastole, tanggal_skrining
        //     FROM skrining
        //     WHERE id_pasien=$1 AND status_validasi='terverifikasi'
        //     ORDER BY tanggal_skrining ASC
        // `, [id_pasien]);

        // ✅ DENGAN QUERY BARU INI (tambah kolom rata-rata & selisih):
        const riwayat = await pool.query(`
            SELECT
                tanggal_skrining,
                sistole,
                diastole,
                ROUND(AVG(sistole) OVER (PARTITION BY id_pasien), 1) AS rata_sistole,
                ROUND(AVG(diastole) OVER (PARTITION BY id_pasien), 1) AS rata_diastole,
                sistole - LAG(sistole) OVER (
                    PARTITION BY id_pasien ORDER BY tanggal_skrining
                ) AS selisih_dari_sebelumnya
            FROM skrining
            WHERE id_pasien = $1
              AND status_validasi = 'terverifikasi'
            ORDER BY tanggal_skrining ASC
        `, [id_pasien]);

        const queryDaftar = `
            SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
            MAX(s.tanggal_skrining) AS kunjungan_terakhir,
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
        const daftarResult = await pool.query(queryDaftar);

        const historiSistole = riwayat.rows.map(r => r.sistole);
        const analisa = analisaTensiPasien(historiSistole);

        res.render('bidan/monitoring', {
            pasienTerpilih: pasien.rows[0],
            riwayatTensi:   riwayat.rows,
            analisa,
            active: 'monitoring',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'bidan'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat grafik tensi.");
    }
};

exports.getApiTensiPasien = async (req, res) => {
    const { id_pasien } = req.params;
    const ptm_type = req.query.ptm_type || 'hipertensi';
    try {
        let query = '';
        if (ptm_type === 'hipertensi') {
            query = `
                SELECT tanggal_skrining, sistole, diastole
                FROM skrining
                WHERE id_pasien = $1
                  AND id_jenis_ptm = 'hipertensi'
                  AND status_validasi = 'terverifikasi'
                ORDER BY tanggal_skrining ASC
            `;
        } else if (ptm_type === 'dm') {
            query = `
                SELECT s.tanggal_skrining, dmt.gula_darah
                FROM skrining s
                JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
                WHERE s.id_pasien = $1
                  AND s.id_jenis_ptm = 'dm'
                  AND s.status_validasi = 'terverifikasi'
                ORDER BY s.tanggal_skrining ASC
            `;
        } else if (ptm_type === 'obesitas') {
            query = `
                SELECT s.tanggal_skrining, obt.imt
                FROM skrining s
                JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
                WHERE s.id_pasien = $1
                  AND s.id_jenis_ptm = 'obesitas'
                  AND s.status_validasi = 'terverifikasi'
                ORDER BY s.tanggal_skrining ASC
            `;
        } else if (ptm_type === 'ppok') {
            query = `
                SELECT s.tanggal_skrining, ppt.skor_total
                FROM skrining s
                JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
                WHERE s.id_pasien = $1
                  AND s.id_jenis_ptm = 'ppok'
                  AND s.status_validasi = 'terverifikasi'
                ORDER BY s.tanggal_skrining ASC
            `;
        } else if (ptm_type === 'gangguan_indra') {
            query = `
                SELECT s.tanggal_skrining, git.hasil_pemeriksaan_mata, git.hasil_pemeriksaan_telinga
                FROM skrining s
                JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
                WHERE s.id_pasien = $1
                  AND s.id_jenis_ptm = 'gangguan_indra'
                  AND s.status_validasi = 'terverifikasi'
                ORDER BY s.tanggal_skrining ASC
            `;
        } else if (ptm_type === 'kesehatan_jiwa') {
            query = `
                SELECT s.tanggal_skrining, kjt.skor_total
                FROM skrining s
                JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
                WHERE s.id_pasien = $1
                  AND s.id_jenis_ptm = 'kesehatan_jiwa'
                  AND s.status_validasi = 'terverifikasi'
                ORDER BY s.tanggal_skrining ASC
            `;
        } else {
            return res.status(400).json({ success: false, error: 'Jenis PTM tidak valid' });
        }

        const result = await pool.query(query, [id_pasien]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('ERROR getApiTensiPasien:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.getApiMonitoringList = async (req, res) => {
    const { ptm_type } = req.params;
    try {
        let query = '';
        if (ptm_type === 'hipertensi') {
            query = `
                SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
                MAX(s.tanggal_skrining)        AS kunjungan_terakhir,
                (SELECT s2.sistole FROM skrining s2 
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='hipertensi' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS sistole_terakhir,
                (SELECT s2.diastole FROM skrining s2 
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='hipertensi' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS diastole_terakhir
                FROM pasien p
                JOIN jorong j ON p.id_jorong = j.id_jorong
                JOIN skrining s ON s.id_pasien = p.id_pasien
                WHERE s.id_jenis_ptm = 'hipertensi' AND s.status_validasi = 'terverifikasi'
                GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
                ORDER BY p.nama_pasien ASC
            `;
        } else if (ptm_type === 'dm') {
            query = `
                SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
                MAX(s.tanggal_skrining)        AS kunjungan_terakhir,
                (SELECT dmt.gula_darah FROM skrining s2
                 JOIN skrining_dm dmt ON s2.id_skrining = dmt.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='dm' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS gula_darah_terakhir,
                (SELECT dmt.kategori_hasil FROM skrining s2
                 JOIN skrining_dm dmt ON s2.id_skrining = dmt.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='dm' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS kategori_hasil
                FROM pasien p
                JOIN jorong j ON p.id_jorong = j.id_jorong
                JOIN skrining s ON s.id_pasien = p.id_pasien
                WHERE s.id_jenis_ptm = 'dm' AND s.status_validasi = 'terverifikasi'
                GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
                ORDER BY p.nama_pasien ASC
            `;
        } else if (ptm_type === 'obesitas') {
            query = `
                SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
                MAX(s.tanggal_skrining)        AS kunjungan_terakhir,
                (SELECT obt.imt FROM skrining s2
                 JOIN skrining_obesitas obt ON s2.id_skrining = obt.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='obesitas' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS imt_terakhir,
                (SELECT obt.kategori_obesitas FROM skrining s2
                 JOIN skrining_obesitas obt ON s2.id_skrining = obt.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='obesitas' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS kategori_hasil
                FROM pasien p
                JOIN jorong j ON p.id_jorong = j.id_jorong
                JOIN skrining s ON s.id_pasien = p.id_pasien
                WHERE s.id_jenis_ptm = 'obesitas' AND s.status_validasi = 'terverifikasi'
                GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
                ORDER BY p.nama_pasien ASC
            `;
        } else if (ptm_type === 'ppok') {
            query = `
                SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
                MAX(s.tanggal_skrining)        AS kunjungan_terakhir,
                (SELECT ppt.skor_total FROM skrining s2
                 JOIN skrining_ppok ppt ON s2.id_skrining = ppt.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='ppok' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS skor_terakhir,
                (SELECT ppt.kategori_risiko FROM skrining s2
                 JOIN skrining_ppok ppt ON s2.id_skrining = ppt.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='ppok' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS kategori_hasil
                FROM pasien p
                JOIN jorong j ON p.id_jorong = j.id_jorong
                JOIN skrining s ON s.id_pasien = p.id_pasien
                WHERE s.id_jenis_ptm = 'ppok' AND s.status_validasi = 'terverifikasi'
                GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
                ORDER BY p.nama_pasien ASC
            `;
        } else if (ptm_type === 'gangguan_indra') {
            query = `
                SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
                MAX(s.tanggal_skrining)        AS kunjungan_terakhir,
                (SELECT git.hasil_pemeriksaan_mata FROM skrining s2
                 JOIN skrining_gangguan_indra git ON s2.id_skrining = git.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='gangguan_indra' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS mata_terakhir,
                (SELECT git.hasil_pemeriksaan_telinga FROM skrining s2
                 JOIN skrining_gangguan_indra git ON s2.id_skrining = git.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='gangguan_indra' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS telinga_terakhir
                FROM pasien p
                JOIN jorong j ON p.id_jorong = j.id_jorong
                JOIN skrining s ON s.id_pasien = p.id_pasien
                WHERE s.id_jenis_ptm = 'gangguan_indra' AND s.status_validasi = 'terverifikasi'
                GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
                ORDER BY p.nama_pasien ASC
            `;
        } else if (ptm_type === 'kesehatan_jiwa') {
            query = `
                SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
                MAX(s.tanggal_skrining)        AS kunjungan_terakhir,
                (SELECT kjt.skor_total FROM skrining s2
                 JOIN skrining_kesehatan_jiwa kjt ON s2.id_skrining = kjt.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='kesehatan_jiwa' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS skor_terakhir,
                (SELECT kjt.kategori_hasil FROM skrining s2
                 JOIN skrining_kesehatan_jiwa kjt ON s2.id_skrining = kjt.id_skrining
                 WHERE s2.id_pasien=p.id_pasien AND s2.id_jenis_ptm='kesehatan_jiwa' AND s2.status_validasi='terverifikasi'
                 ORDER BY s2.tanggal_skrining DESC LIMIT 1) AS kategori_hasil
                FROM pasien p
                JOIN jorong j ON p.id_jorong = j.id_jorong
                JOIN skrining s ON s.id_pasien = p.id_pasien
                WHERE s.id_jenis_ptm = 'kesehatan_jiwa' AND s.status_validasi = 'terverifikasi'
                GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
                ORDER BY p.nama_pasien ASC
            `;
        } else {
            return res.status(400).json({ success: false, error: 'Jenis PTM tidak valid' });
        }

        const result = await pool.query(query);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('ERROR getApiMonitoringList:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};