const pool = require('../config/db');

// 1. Rekap Wilayah untuk Bidan (F.20)
// 1. Rekap Wilayah untuk Bidan (F.20)
exports.renderRekapBidan = async (req, res) => {
    try {
        // A. Data Kartu (Bulan Ini)
        const queryCards = `
            SELECT 
                COUNT(s.id_skrining) AS total_pasien,
                COUNT(CASE WHEN s.sistole >= 140 THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN s.sistole < 140 THEN 1 END) AS terkendali
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(MONTH FROM k.tanggal_kegiatan) = EXTRACT(MONTH FROM CURRENT_DATE)
              AND EXTRACT(YEAR FROM k.tanggal_kegiatan) = EXTRACT(YEAR FROM CURRENT_DATE)
        `;
        const resultCards = await pool.query(queryCards);
        const cards = resultCards.rows[0];

        // B. Data Rekap per Jorong (Untuk Tabel & Chart Horizontal)
        const queryJorong = `
            SELECT 
                j.nama_jorong,
                COUNT(s.id_skrining) AS total,
                COUNT(CASE WHEN s.sistole >= 140 THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN s.sistole < 140 THEN 1 END) AS terkendali
            FROM jorong j
            LEFT JOIN pasien p ON j.id_jorong = p.id_jorong
            LEFT JOIN skrining s ON p.id_pasien = s.id_pasien AND s.status_validasi = 'terverifikasi'
            GROUP BY j.nama_jorong
            ORDER BY j.nama_jorong ASC
        `;
        const resultJorong = await pool.query(queryJorong);

        // C. Data Tren 6 Bulan Terakhir (Untuk Line Chart)
        const queryTrend = `
            SELECT 
                TO_CHAR(k.tanggal_kegiatan, 'Mon YYYY') as bulan_label,
                EXTRACT(MONTH FROM k.tanggal_kegiatan) as bulan_angka,
                EXTRACT(YEAR FROM k.tanggal_kegiatan) as tahun_angka,
                COUNT(s.id_skrining) AS total,
                COUNT(CASE WHEN s.sistole >= 140 THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN s.sistole < 140 THEN 1 END) AS terkendali
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
            GROUP BY bulan_label, tahun_angka, bulan_angka
            ORDER BY tahun_angka ASC, bulan_angka ASC
            LIMIT 6
        `;
        const resultTrend = await pool.query(queryTrend);

        res.render('bidan/rekapbidan', {
            active: 'rekap',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'bidan',
            cards: cards,
            rekapJorong: resultJorong.rows,
            trendBulanan: resultTrend.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat halaman rekapitulasi bidan.");
    }
};

// 2. Rekap Periode untuk PJ PTM (F.26-27)
exports.renderRekapPTM = async (req, res) => {
    try {
        const query = `
            SELECT
                per.periode_id,
                per.periode_bulan,
                per.periode_tahun,
                COUNT(DISTINCT s.id_pasien)                                          AS total_pasien_diperiksa,
                COUNT(s.id_skrining)                                                 AS total_kunjungan,
                COUNT(DISTINCT CASE
                    WHEN s.sistole >= 140 OR s.diastole >= 90 THEN s.id_pasien
                END)                                                                 AS total_hipertensi,
                COUNT(DISTINCT last_s.id_pasien)                                     AS terkendali
            FROM periode per
            LEFT JOIN kegiatan k   ON per.periode_id = k.id_periode
            LEFT JOIN skrining s   ON k.id_kegiatan  = s.id_kegiatan
                                   AND s.status_validasi IN ('terverifikasi', 'diterima')
            LEFT JOIN LATERAL (
                SELECT s2.id_pasien
                FROM skrining s2
                JOIN kegiatan k2 ON k2.id_kegiatan = s2.id_kegiatan
                WHERE k2.id_periode = per.periode_id
                  AND s2.id_pasien  = s.id_pasien
                  AND s2.status_validasi IN ('terverifikasi', 'diterima')
                  AND s2.sistole < 140
                  AND s2.diastole < 90
                ORDER BY s2.tanggal_skrining DESC
                LIMIT 1
            ) last_s ON true
            GROUP BY per.periode_id, per.periode_bulan, per.periode_tahun
            ORDER BY per.periode_tahun DESC, per.periode_bulan DESC
        `;
        const result = await pool.query(query);

        res.render('ptm/rekapptm', {
            rekapData: result.rows,
            active: 'rekap',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat halaman rekapitulasi PTM.");
    }
};

// 3. Halaman cetak rekap per periode (print to PDF dari browser)
exports.renderCetakRekapPeriode = async (req, res) => {
    const { periode_id } = req.params;
    try {
        const periodeRes = await pool.query(
            'SELECT * FROM periode WHERE periode_id = $1',
            [parseInt(periode_id)]
        );
        if (periodeRes.rows.length === 0) {
            return res.status(404).send('Periode tidak ditemukan.');
        }
        const periode = periodeRes.rows[0];

        const aggRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien)                                      AS total_pasien,
                COUNT(s.id_skrining)                                             AS total_kunjungan,
                COUNT(DISTINCT CASE
                    WHEN s.sistole >= 140 OR s.diastole >= 90 THEN s.id_pasien
                END)                                                             AS total_hipertensi,
                ROUND(AVG(s.sistole)::numeric, 1)                                AS rata_sistole,
                ROUND(AVG(s.diastole)::numeric, 1)                               AS rata_diastole
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE k.id_periode = $1
              AND s.status_validasi IN ('terverifikasi', 'diterima')
        `, [parseInt(periode_id)]);

        const terkendaliRes = await pool.query(`
            SELECT COUNT(*) AS terkendali
            FROM (
                SELECT DISTINCT ON (s.id_pasien) s.id_pasien, s.sistole, s.diastole
                FROM skrining s
                JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                WHERE k.id_periode = $1
                  AND s.status_validasi IN ('terverifikasi', 'diterima')
                ORDER BY s.id_pasien, s.tanggal_skrining DESC
            ) sub
            WHERE sub.sistole < 140 AND sub.diastole < 90
        `, [parseInt(periode_id)]);

        const nagariRes = await pool.query(`
            SELECT
                n.nama_nagari,
                COUNT(DISTINCT s.id_pasien)                                      AS total_pasien,
                COUNT(s.id_skrining)                                             AS total_kunjungan,
                COUNT(DISTINCT CASE
                    WHEN s.sistole >= 140 OR s.diastole >= 90 THEN s.id_pasien
                END)                                                             AS hipertensi
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN pasien   p ON s.id_pasien   = p.id_pasien
            JOIN jorong   j ON p.id_jorong   = j.id_jorong
            JOIN nagari   n ON j.id_nagari   = n.id_nagari
            WHERE k.id_periode = $1
              AND s.status_validasi IN ('terverifikasi', 'diterima')
            GROUP BY n.nama_nagari
            ORDER BY total_pasien DESC
        `, [parseInt(periode_id)]);

        const agg = aggRes.rows[0];
        const terkendali = parseInt(terkendaliRes.rows[0].terkendali) || 0;
        const NAMA_BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        res.render('ptm/cetak_rekap', {
            periode,
            namaBulan: NAMA_BULAN[parseInt(periode.periode_bulan)],
            agg: {
                total_pasien:     parseInt(agg.total_pasien)    || 0,
                total_kunjungan:  parseInt(agg.total_kunjungan) || 0,
                total_hipertensi: parseInt(agg.total_hipertensi)|| 0,
                terkendali,
                rata_sistole:  parseFloat(agg.rata_sistole)  || 0,
                rata_diastole: parseFloat(agg.rata_diastole) || 0,
            },
            perNagari: nagariRes.rows,
            currentUser: req.session.user || null,
            tanggalCetak: new Date().toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
            })
        });
    } catch (err) {
        console.error('Error renderCetakRekapPeriode:', err);
        res.status(500).send('Gagal memuat halaman cetak rekap: ' + err.message);
    }
};