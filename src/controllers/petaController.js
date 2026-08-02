// ============================================================
// FILE: src/controllers/petaController.js
// Fungsi: Menyediakan data persebaran pasien hipertensi
//         per nagari di Kecamatan IV Koto untuk ditampilkan
//         di peta Leaflet.js
// ============================================================

const pool = require('../config/db');

/**
 * Render halaman peta hipertensi.
 * Akses: GET /peta-hipertensi
 */
exports.renderPetaHipertensi = async (req, res) => {
    try {
        const ptmRes = await pool.query(`SELECT * FROM jenis_ptm ORDER BY nama_ptm ASC`);
        res.render('kepala/peta_hipertensi', {
            active: 'peta-hipertensi',
            pageTitle: 'Peta Persebaran PTM',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kepala_puskesmas',
            jenisPtmOptions: ptmRes.rows
        });
    } catch (err) {
        console.error('Error renderPetaHipertensi:', err);
        res.status(500).send('Gagal memuat halaman peta');
    }
};

/**
 * API endpoint — kembalikan JSON data PTM per nagari.
 * Frontend (Leaflet) memanggil endpoint ini via fetch().
 */
exports.getDataPetaHipertensi = async (req, res) => {
    try {
        const { bulan, tahun, jenis_ptm } = req.query;
        const jenisPtmTerpilih = jenis_ptm || 'hipertensi';

        let filterAbnormal = 's.sistole >= 140 OR s.diastole >= 90';
        let joinTables = `
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
        `;

        if (jenisPtmTerpilih === 'dm') {
            filterAbnormal = `dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s.gula_darah >= 140`;
            joinTables = `
                LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            `;
        } else if (jenisPtmTerpilih === 'obesitas') {
            filterAbnormal = `obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25`;
            joinTables = `
                LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            `;
        } else if (jenisPtmTerpilih === 'ppok') {
            filterAbnormal = `ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4`;
            joinTables = `
                LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            `;
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            filterAbnormal = `git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'`;
            joinTables = `
                LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            `;
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
            filterAbnormal = `kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6`;
            joinTables = `
                LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            `;
        }

        // -------------------------------------------------------
        // CABANG 1: Filter berdasarkan bulan & tahun tertentu
        // -------------------------------------------------------
        if (bulan && tahun) {
            const result = await pool.query(`
                SELECT
                    n.nama_nagari,
                    COUNT(DISTINCT s.id_pasien)::int                                                     AS total_pasien,
                    COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END)::int                AS total_hipertensi
                FROM skrining s
                JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                JOIN pasien p   ON s.id_pasien   = p.id_pasien
                JOIN jorong j   ON p.id_jorong   = j.id_jorong
                JOIN nagari n   ON j.id_nagari   = n.id_nagari
                ${joinTables}
                WHERE s.status_validasi = 'terverifikasi'
                  AND s.id_jenis_ptm = $1
                  AND EXTRACT(MONTH FROM k.tanggal_kegiatan) = $2
                  AND EXTRACT(YEAR  FROM k.tanggal_kegiatan) = $3
                GROUP BY n.nama_nagari
                ORDER BY total_hipertensi DESC
            `, [jenisPtmTerpilih, parseInt(bulan), parseInt(tahun)]);

            if (result.rows.length === 0) {
                return res.json({ success: true, data: [] });
            }

            const data = result.rows.map(row => ({
                nama_nagari:       row.nama_nagari,
                total_pasien:      parseInt(row.total_pasien),
                total_hipertensi:  parseInt(row.total_hipertensi),
                persen_hipertensi: row.total_pasien > 0
                    ? parseFloat(((row.total_hipertensi / row.total_pasien) * 100).toFixed(2))
                    : 0
            }));

            return res.json({ success: true, data });
        }

        // -------------------------------------------------------
        // CABANG 2: Tanpa filter — semua data terverifikasi
        // -------------------------------------------------------
        const result = await pool.query(`
            SELECT
                n.nama_nagari,
                COUNT(DISTINCT s.id_pasien)::int                                                     AS total_pasien,
                COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END)::int                AS total_hipertensi
            FROM skrining s
            JOIN pasien p ON s.id_pasien   = p.id_pasien
            JOIN jorong j ON p.id_jorong   = j.id_jorong
            JOIN nagari n ON j.id_nagari   = n.id_nagari
            ${joinTables}
            WHERE s.status_validasi = 'terverifikasi'
              AND s.id_jenis_ptm = $1
            GROUP BY n.nama_nagari
            ORDER BY total_hipertensi DESC
        `, [jenisPtmTerpilih]);

        const data = result.rows.map(row => ({
            nama_nagari:       row.nama_nagari,
            total_pasien:      parseInt(row.total_pasien),
            total_hipertensi:  parseInt(row.total_hipertensi),
            persen_hipertensi: row.total_pasien > 0
                ? parseFloat(((row.total_hipertensi / row.total_pasien) * 100).toFixed(2))
                : 0
        }));

        return res.json({ success: true, data });

    } catch (err) {
        console.error('Error getDataPetaHipertensi:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};
