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
        res.render('kepala/peta_hipertensi', {
            active: 'peta-hipertensi',
            pageTitle: 'Peta Persebaran Hipertensi',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kepala_puskesmas'
        });
    } catch (err) {
        console.error('Error renderPetaHipertensi:', err);
        res.status(500).send('Gagal memuat halaman peta');
    }
};

/**
 * API endpoint — kembalikan JSON data hipertensi per nagari.
 * Frontend (Leaflet) memanggil endpoint ini via fetch().
 *
 * Query param opsional:
 *   ?bulan=5&tahun=2025   → filter satu bulan tertentu
 *   (tanpa param)         → ambil semua data yang sudah terverifikasi
 *
 * Akses: GET /api/peta-hipertensi
 *
 * Response format:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "nama_nagari": "Koto Tuo",
 *       "total_pasien": 42,
 *       "total_hipertensi": 18,
 *       "persen_hipertensi": 42.86
 *     },
 *     ...
 *   ]
 * }
 */
exports.getDataPetaHipertensi = async (req, res) => {
    try {
        const { bulan, tahun } = req.query;

        // -------------------------------------------------------
        // CABANG 1: Filter berdasarkan bulan & tahun tertentu
        // -------------------------------------------------------
        if (bulan && tahun) {
            // Filter langsung berdasarkan EXTRACT bulan & tahun dari tanggal_kegiatan
            // lebih reliable daripada lookup id_periode
            const result = await pool.query(`
                SELECT
                    n.nama_nagari,
                    COUNT(DISTINCT s.id_pasien)                                                          AS total_pasien,
                    COUNT(DISTINCT CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN s.id_pasien END) AS total_hipertensi
                FROM skrining s
                JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                JOIN pasien p   ON s.id_pasien   = p.id_pasien
                JOIN jorong j   ON p.id_jorong   = j.id_jorong
                JOIN nagari n   ON j.id_nagari   = n.id_nagari
                WHERE s.status_validasi = 'terverifikasi'
                  AND EXTRACT(MONTH FROM k.tanggal_kegiatan) = $1
                  AND EXTRACT(YEAR  FROM k.tanggal_kegiatan) = $2
                GROUP BY n.nama_nagari
                ORDER BY total_hipertensi DESC
            `, [parseInt(bulan), parseInt(tahun)]);

            // Kalau tidak ada data untuk bulan/tahun ini, kembalikan array kosong
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
                COUNT(DISTINCT s.id_pasien)                                                          AS total_pasien,
                COUNT(DISTINCT CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN s.id_pasien END) AS total_hipertensi
            FROM skrining s
            JOIN pasien p ON s.id_pasien   = p.id_pasien
            JOIN jorong j ON p.id_jorong   = j.id_jorong
            JOIN nagari n ON j.id_nagari   = n.id_nagari
            WHERE s.status_validasi = 'terverifikasi'
            GROUP BY n.nama_nagari
            ORDER BY total_hipertensi DESC
        `);

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
