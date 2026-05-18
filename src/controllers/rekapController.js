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
        // Menghitung rekapitulasi skrining berdasarkan periode bulan & tahun
        const query = `
            SELECT per.periode_bulan, per.periode_tahun,
                   COUNT(DISTINCT s.id_pasien) AS total_pasien_diperiksa,
                   COUNT(s.id_skrining) AS total_kunjungan
            FROM periode per
            LEFT JOIN kegiatan k ON per.periode_id = k.id_periode
            LEFT JOIN skrining s ON k.id_kegiatan = s.id_kegiatan AND s.status_validasi = 'terverifikasi'
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