const pool = require('../config/db');

// 1. Rekap Wilayah untuk Bidan (F.20)
// 1. Rekap Wilayah untuk Bidan (F.20)
exports.renderRekapBidan = async (req, res) => {
    try {
        // A. Data Kartu (Bulan Ini)
        const queryCards = `
            SELECT 
                COUNT(s.id_skrining) AS total_pasien,
                COUNT(CASE WHEN s.status_rujukan = 'ya' THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN s.status_rujukan = 'tidak' OR s.status_rujukan IS NULL THEN 1 END) AS terkendali
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
                COUNT(CASE WHEN s.status_rujukan = 'ya' THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN s.status_rujukan = 'tidak' OR s.status_rujukan IS NULL THEN 1 END) AS terkendali
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
                COUNT(CASE WHEN s.status_rujukan = 'ya' THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN s.status_rujukan = 'tidak' OR s.status_rujukan IS NULL THEN 1 END) AS terkendali
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
        const tahunIni = new Date().getFullYear();
        const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';
        const tahunDipilih = parseInt(req.query.tahun) || tahunIni;
        const activeTab = req.query.tab || 'periode';
        const levelWilayah = req.query.level || 'nagari';

        // Ambil daftar jenis PTM
        const resJenisPtm = await pool.query(
            'SELECT id_jenis_ptm, nama_ptm FROM jenis_ptm ORDER BY nama_ptm'
        );
        
        // Ambil nama PTM terpilih
        const resActivePtm = await pool.query(
            'SELECT nama_ptm FROM jenis_ptm WHERE id_jenis_ptm = $1',
            [jenisPtmTerpilih]
        );
        const namaPtmTerpilih = resActivePtm.rows.length > 0 ? resActivePtm.rows[0].nama_ptm : 'Hipertensi';

        let filterAbnormal = 's.sistole >= 140 OR s.diastole >= 90';
        let filterNormal = 's.sistole < 140 AND s.diastole < 90';
        let filterNormalLateral = 's2.sistole < 140 AND s2.diastole < 90';

        if (jenisPtmTerpilih === 'dm') {
            filterAbnormal = `dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s.gula_darah >= 140`;
            filterNormal = `s.gula_darah < 140 AND dmt.kategori_hasil = 'Normal'`;
            filterNormalLateral = `s2.gula_darah < 140 AND dmt2.kategori_hasil = 'Normal'`;
        } else if (jenisPtmTerpilih === 'obesitas') {
            filterAbnormal = `obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25`;
            filterNormal = `obt.kategori_obesitas = 'Normal' OR (obt.imt < 25 AND obt.imt > 0)`;
            filterNormalLateral = `obt2.kategori_obesitas = 'Normal' OR (obt2.imt < 25 AND obt2.imt > 0)`;
        } else if (jenisPtmTerpilih === 'ppok') {
            filterAbnormal = `ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4`;
            filterNormal = `ppt.kategori_risiko = 'Rendah' OR (ppt.skor_total < 4 AND ppt.skor_total >= 0)`;
            filterNormalLateral = `ppt2.kategori_risiko = 'Rendah' OR (ppt2.skor_total < 4 AND ppt2.skor_total >= 0)`;
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            filterAbnormal = `git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'`;
            filterNormal = `git.hasil_pemeriksaan_mata = 'Normal' AND git.hasil_pemeriksaan_telinga = 'Normal'`;
            filterNormalLateral = `git2.hasil_pemeriksaan_mata = 'Normal' AND git2.hasil_pemeriksaan_telinga = 'Normal'`;
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
            filterAbnormal = `kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6`;
            filterNormal = `kjt.kategori_hasil = 'Normal' OR (kjt.skor_total < 6 AND kjt.skor_total >= 0)`;
            filterNormalLateral = `kjt2.kategori_hasil = 'Normal' OR (kjt2.skor_total < 6 AND kjt2.skor_total >= 0)`;
        }

        let rekapData = [];

        if (activeTab === 'periode') {
            const query = `
                SELECT
                    per.periode_id,
                    per.periode_bulan,
                    per.periode_tahun,
                    COUNT(DISTINCT s.id_pasien)                                          AS total_pasien_diperiksa,
                    COUNT(s.id_skrining)                                                 AS total_kunjungan,
                    COUNT(DISTINCT CASE
                        WHEN ${filterAbnormal} THEN s.id_pasien
                    END)                                                                 AS total_hipertensi,
                    COUNT(DISTINCT last_s.id_pasien)                                     AS terkendali
                FROM periode per
                LEFT JOIN kegiatan k   ON per.periode_id = k.id_periode
                LEFT JOIN skrining s   ON k.id_kegiatan  = s.id_kegiatan
                                       AND s.status_validasi IN ('terverifikasi', 'diterima')
                                       AND s.id_jenis_ptm = $1
                LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
                LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
                LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
                LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
                LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
                LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
                LEFT JOIN LATERAL (
                    SELECT s2.id_pasien
                    FROM skrining s2
                    JOIN kegiatan k2 ON k2.id_kegiatan = s2.id_kegiatan
                    LEFT JOIN skrining_hipertensi hp2 ON s2.id_skrining = hp2.id_skrining
                    LEFT JOIN skrining_dm dmt2 ON s2.id_skrining = dmt2.id_skrining
                    LEFT JOIN skrining_obesitas obt2 ON s2.id_skrining = obt2.id_skrining
                    LEFT JOIN skrining_ppok ppt2 ON s2.id_skrining = ppt2.id_skrining
                    LEFT JOIN skrining_gangguan_indra git2 ON s2.id_skrining = git2.id_skrining
                    LEFT JOIN skrining_kesehatan_jiwa kjt2 ON s2.id_skrining = kjt2.id_skrining
                    WHERE k2.id_periode = per.periode_id
                      AND s2.id_pasien  = s.id_pasien
                      AND s2.status_validasi IN ('terverifikasi', 'diterima')
                      AND s2.id_jenis_ptm = $1
                      AND (${filterNormalLateral})
                    ORDER BY s2.tanggal_skrining DESC
                    LIMIT 1
                ) last_s ON true
                GROUP BY per.periode_id, per.periode_bulan, per.periode_tahun
                ORDER BY per.periode_tahun DESC, per.periode_bulan DESC
            `;
            const result = await pool.query(query, [jenisPtmTerpilih]);
            rekapData = result.rows;
        } else {
            // tab === 'wilayah'
            if (levelWilayah === 'nagari') {
                const query = `
                    SELECT 
                        n.id_nagari,
                        n.nama_nagari AS nama_wilayah,
                        COUNT(s.id_skrining) AS total_kunjungan,
                        COUNT(DISTINCT s.id_pasien) AS total_pasien_diperiksa,
                        COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) AS total_hipertensi,
                        COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) AS terkendali
                    FROM nagari n
                    LEFT JOIN jorong j ON n.id_nagari = j.id_nagari
                    LEFT JOIN pasien p ON j.id_jorong = p.id_jorong
                    LEFT JOIN skrining s ON p.id_pasien = s.id_pasien 
                        AND s.status_validasi = 'terverifikasi'
                        AND EXTRACT(YEAR FROM s.tanggal_skrining) = $1
                        AND s.id_jenis_ptm = $2
                    LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
                    LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
                    LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
                    LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
                    LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
                    LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
                    WHERE n.is_active = true
                    GROUP BY n.id_nagari, n.nama_nagari
                    ORDER BY n.nama_nagari ASC
                `;
                const result = await pool.query(query, [tahunDipilih, jenisPtmTerpilih]);
                rekapData = result.rows;
            } else {
                // level === 'jorong'
                const query = `
                    SELECT 
                        j.id_jorong,
                        j.nama_jorong AS nama_wilayah,
                        n.nama_nagari,
                        COUNT(s.id_skrining) AS total_kunjungan,
                        COUNT(DISTINCT s.id_pasien) AS total_pasien_diperiksa,
                        COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) AS total_hipertensi,
                        COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) AS terkendali
                    FROM jorong j
                    JOIN nagari n ON j.id_nagari = n.id_nagari
                    LEFT JOIN pasien p ON j.id_jorong = p.id_jorong
                    LEFT JOIN skrining s ON p.id_pasien = s.id_pasien 
                        AND s.status_validasi = 'terverifikasi'
                        AND EXTRACT(YEAR FROM s.tanggal_skrining) = $1
                        AND s.id_jenis_ptm = $2
                    LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
                    LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
                    LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
                    LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
                    LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
                    LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
                    WHERE n.is_active = true
                    GROUP BY j.id_jorong, j.nama_jorong, n.nama_nagari
                    ORDER BY n.nama_nagari ASC, j.nama_jorong ASC
                `;
                const result = await pool.query(query, [tahunDipilih, jenisPtmTerpilih]);
                rekapData = result.rows;
            }
        }

        res.render('ptm/rekapptm', {
            rekapData,
            active: 'rekap',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm',
            jenisPtmList: resJenisPtm.rows,
            jenisPtmTerpilih,
            namaPtmTerpilih,
            tahunDipilih,
            activeTab,
            levelWilayah,
            tahunIni
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat halaman rekapitulasi PTM.");
    }
};

// 3. Halaman cetak rekap per periode (print to PDF dari browser)
exports.renderCetakRekapPeriode = async (req, res) => {
    const { periode_id } = req.params;
    const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';

    try {
        const periodeRes = await pool.query(
            'SELECT * FROM periode WHERE periode_id = $1',
            [parseInt(periode_id)]
        );
        if (periodeRes.rows.length === 0) {
            return res.status(404).send('Periode tidak ditemukan.');
        }
        const periode = periodeRes.rows[0];

        // Ambil nama PTM terpilih
        const resActivePtm = await pool.query(
            'SELECT nama_ptm FROM jenis_ptm WHERE id_jenis_ptm = $1',
            [jenisPtmTerpilih]
        );
        const namaPtmTerpilih = resActivePtm.rows.length > 0 ? resActivePtm.rows[0].nama_ptm : 'Hipertensi';

        let filterAbnormal = 's.sistole >= 140 OR s.diastole >= 90';
        let filterNormal = 's.sistole < 140 AND s.diastole < 90';

        if (jenisPtmTerpilih === 'dm') {
            filterAbnormal = `dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s.gula_darah >= 140`;
            filterNormal = `s.gula_darah < 140 AND dmt.kategori_hasil = 'Normal'`;
        } else if (jenisPtmTerpilih === 'obesitas') {
            filterAbnormal = `obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25`;
            filterNormal = `obt.kategori_obesitas = 'Normal' OR (obt.imt < 25 AND obt.imt > 0)`;
        } else if (jenisPtmTerpilih === 'ppok') {
            filterAbnormal = `ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4`;
            filterNormal = `ppt.kategori_risiko = 'Rendah' OR (ppt.skor_total < 4 AND ppt.skor_total >= 0)`;
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            filterAbnormal = `git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'`;
            filterNormal = `git.hasil_pemeriksaan_mata = 'Normal' AND git.hasil_pemeriksaan_telinga = 'Normal'`;
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
            filterAbnormal = `kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6`;
            filterNormal = `kjt.kategori_hasil = 'Normal' OR (kjt.skor_total < 6 AND kjt.skor_total >= 0)`;
        }

        const aggRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien)                                      AS total_pasien,
                COUNT(s.id_skrining)                                             AS total_kunjungan,
                COUNT(DISTINCT CASE
                    WHEN ${filterAbnormal} THEN s.id_pasien
                END)                                                             AS total_hipertensi,
                ROUND(AVG(CASE WHEN s.id_jenis_ptm = 'hipertensi' THEN s.sistole END)::numeric, 1)    AS rata_sistole,
                ROUND(AVG(CASE WHEN s.id_jenis_ptm = 'hipertensi' THEN s.diastole END)::numeric, 1)   AS rata_diastole
            FROM skrining s
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE k.id_periode = $1
              AND s.status_validasi IN ('terverifikasi', 'diterima')
              AND s.id_jenis_ptm = $2
        `, [parseInt(periode_id), jenisPtmTerpilih]);

        const terkendaliRes = await pool.query(`
            SELECT COUNT(*) AS terkendali
            FROM (
                SELECT DISTINCT ON (s.id_pasien) s.id_pasien, s.id_skrining
                FROM skrining s
                JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                WHERE k.id_periode = $1
                  AND s.status_validasi IN ('terverifikasi', 'diterima')
                  AND s.id_jenis_ptm = $2
                ORDER BY s.id_pasien, s.tanggal_skrining DESC
            ) sub
            JOIN skrining s ON sub.id_skrining = s.id_skrining
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            WHERE ${filterNormal}
        `, [parseInt(periode_id), jenisPtmTerpilih]);

        const nagariRes = await pool.query(`
            SELECT
                n.nama_nagari,
                COUNT(DISTINCT s.id_pasien)                                      AS total_pasien,
                COUNT(s.id_skrining)                                             AS total_kunjungan,
                COUNT(DISTINCT CASE
                    WHEN ${filterAbnormal} THEN s.id_pasien
                END)                                                             AS hipertensi
            FROM skrining s
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN pasien   p ON s.id_pasien   = p.id_pasien
            JOIN jorong   j ON p.id_jorong   = j.id_jorong
            JOIN nagari   n ON j.id_nagari   = n.id_nagari
            WHERE k.id_periode = $1
              AND s.status_validasi IN ('terverifikasi', 'diterima')
              AND s.id_jenis_ptm = $2
            GROUP BY n.nama_nagari
            ORDER BY total_pasien DESC
        `, [parseInt(periode_id), jenisPtmTerpilih]);

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
            jenisPtmTerpilih,
            namaPtmTerpilih,
            tanggalCetak: new Date().toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
            })
        });
    } catch (err) {
        console.error('Error renderCetakRekapPeriode:', err);
        res.status(500).send('Gagal memuat halaman cetak rekap: ' + err.message);
    }
};

exports.renderCetakRekapWilayah = async (req, res) => {
    const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';
    const tahunDipilih = parseInt(req.query.tahun) || new Date().getFullYear();
    const levelWilayah = req.query.level || 'nagari';

    try {
        // Ambil nama PTM terpilih
        const resActivePtm = await pool.query(
            'SELECT nama_ptm FROM jenis_ptm WHERE id_jenis_ptm = $1',
            [jenisPtmTerpilih]
        );
        const namaPtmTerpilih = resActivePtm.rows.length > 0 ? resActivePtm.rows[0].nama_ptm : 'Hipertensi';

        let filterAbnormal = 's.sistole >= 140 OR s.diastole >= 90';
        let filterNormal = 's.sistole < 140 AND s.diastole < 90';

        if (jenisPtmTerpilih === 'dm') {
            filterAbnormal = `dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s.gula_darah >= 140`;
            filterNormal = `s.gula_darah < 140 AND dmt.kategori_hasil = 'Normal'`;
        } else if (jenisPtmTerpilih === 'obesitas') {
            filterAbnormal = `obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25`;
            filterNormal = `obt.kategori_obesitas = 'Normal' OR (obt.imt < 25 AND obt.imt > 0)`;
        } else if (jenisPtmTerpilih === 'ppok') {
            filterAbnormal = `ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4`;
            filterNormal = `ppt.kategori_risiko = 'Rendah' OR (ppt.skor_total < 4 AND ppt.skor_total >= 0)`;
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            filterAbnormal = `git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'`;
            filterNormal = `git.hasil_pemeriksaan_mata = 'Normal' AND git.hasil_pemeriksaan_telinga = 'Normal'`;
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
            filterAbnormal = `kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6`;
            filterNormal = `kjt.kategori_hasil = 'Normal' OR (kjt.skor_total < 6 AND kjt.skor_total >= 0)`;
        }

        // 1. Agregat Total Nasional/Kecamatan
        const aggRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien) AS total_pasien,
                COUNT(s.id_skrining) AS total_kunjungan,
                COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) AS total_hipertensi,
                COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) AS terkendali
            FROM skrining s
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(YEAR FROM s.tanggal_skrining) = $1
              AND s.id_jenis_ptm = $2
        `, [tahunDipilih, jenisPtmTerpilih]);

        const agg = aggRes.rows[0];

        // 2. Data Wilayah (Nagari vs Jorong)
        let rekapWilayah = [];
        if (levelWilayah === 'nagari') {
            const query = `
                SELECT 
                    n.id_nagari,
                    n.nama_nagari AS nama_wilayah,
                    COUNT(s.id_skrining) AS total_kunjungan,
                    COUNT(DISTINCT s.id_pasien) AS total_pasien,
                    COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) AS total_hipertensi,
                    COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) AS terkendali
                FROM nagari n
                LEFT JOIN jorong j ON n.id_nagari = j.id_nagari
                LEFT JOIN pasien p ON j.id_jorong = p.id_jorong
                LEFT JOIN skrining s ON p.id_pasien = s.id_pasien 
                    AND s.status_validasi = 'terverifikasi'
                    AND EXTRACT(YEAR FROM s.tanggal_skrining) = $1
                    AND s.id_jenis_ptm = $2
                LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
                LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
                LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
                LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
                LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
                LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
                WHERE n.is_active = true
                GROUP BY n.id_nagari, n.nama_nagari
                ORDER BY n.nama_nagari ASC
            `;
            const result = await pool.query(query, [tahunDipilih, jenisPtmTerpilih]);
            rekapWilayah = result.rows;
        } else {
            const query = `
                SELECT 
                    j.id_jorong,
                    j.nama_jorong AS nama_wilayah,
                    n.nama_nagari,
                    COUNT(s.id_skrining) AS total_kunjungan,
                    COUNT(DISTINCT s.id_pasien) AS total_pasien,
                    COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) AS total_hipertensi,
                    COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) AS terkendali
                FROM jorong j
                JOIN nagari n ON j.id_nagari = n.id_nagari
                LEFT JOIN pasien p ON j.id_jorong = p.id_jorong
                LEFT JOIN skrining s ON p.id_pasien = s.id_pasien 
                    AND s.status_validasi = 'terverifikasi'
                    AND EXTRACT(YEAR FROM s.tanggal_skrining) = $1
                    AND s.id_jenis_ptm = $2
                LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
                LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
                LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
                LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
                LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
                LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
                WHERE n.is_active = true
                GROUP BY j.id_jorong, j.nama_jorong, n.nama_nagari
                ORDER BY n.nama_nagari ASC, j.nama_jorong ASC
            `;
            const result = await pool.query(query, [tahunDipilih, jenisPtmTerpilih]);
            rekapWilayah = result.rows;
        }

        res.render('ptm/cetak_rekap_wilayah', {
            tahunDipilih,
            levelWilayah,
            jenisPtmTerpilih,
            namaPtmTerpilih,
            agg: {
                total_pasien: parseInt(agg.total_pasien) || 0,
                total_kunjungan: parseInt(agg.total_kunjungan) || 0,
                total_hipertensi: parseInt(agg.total_hipertensi) || 0,
                terkendali: parseInt(agg.terkendali) || 0
            },
            rekapWilayah,
            currentUser: req.session.user || null,
            tanggalCetak: new Date().toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
            })
        });
    } catch (err) {
        console.error('Error renderCetakRekapWilayah:', err);
        res.status(500).send('Gagal memuat halaman cetak rekap wilayah: ' + err.message);
    }
};

exports.renderCetakDetailWilayah = async (req, res) => {
    const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';
    const tahunDipilih = parseInt(req.query.tahun) || new Date().getFullYear();
    const levelWilayah = req.query.level || 'nagari';
    const areaId = req.query.id;

    try {
        if (!areaId) {
            return res.status(400).send('ID wilayah tidak valid.');
        }

        // Ambil nama PTM terpilih
        const resActivePtm = await pool.query(
            'SELECT nama_ptm FROM jenis_ptm WHERE id_jenis_ptm = $1',
            [jenisPtmTerpilih]
        );
        const namaPtmTerpilih = resActivePtm.rows.length > 0 ? resActivePtm.rows[0].nama_ptm : 'Hipertensi';

        // Ambil info wilayah
        let namaWilayah = '';
        let namaNagari = '';
        if (levelWilayah === 'nagari') {
            const areaRes = await pool.query('SELECT nama_nagari FROM nagari WHERE id_nagari = $1', [areaId]);
            if (areaRes.rows.length === 0) return res.status(404).send('Nagari tidak ditemukan.');
            namaWilayah = areaRes.rows[0].nama_nagari;
        } else {
            const areaRes = await pool.query(
                'SELECT j.nama_jorong, n.nama_nagari FROM jorong j JOIN nagari n ON j.id_nagari = n.id_nagari WHERE j.id_jorong = $1',
                [areaId]
            );
            if (areaRes.rows.length === 0) return res.status(404).send('Jorong tidak ditemukan.');
            namaWilayah = areaRes.rows[0].nama_jorong;
            namaNagari = areaRes.rows[0].nama_nagari;
        }

        let filterAbnormal = 's.sistole >= 140 OR s.diastole >= 90';
        let filterNormal = 's.sistole < 140 AND s.diastole < 90';
        let filterAbnormalWithS2 = 's2.sistole >= 140 OR s2.diastole >= 90';

        if (jenisPtmTerpilih === 'dm') {
            filterAbnormal = `dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s.gula_darah >= 140`;
            filterNormal = `s.gula_darah < 140 AND dmt.kategori_hasil = 'Normal'`;
            filterAbnormalWithS2 = `dmt2.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s2.gula_darah >= 140`;
        } else if (jenisPtmTerpilih === 'obesitas') {
            filterAbnormal = `obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25`;
            filterNormal = `obt.kategori_obesitas = 'Normal' OR (obt.imt < 25 AND obt.imt > 0)`;
            filterAbnormalWithS2 = `obt2.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt2.imt >= 25`;
        } else if (jenisPtmTerpilih === 'ppok') {
            filterAbnormal = `ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4`;
            filterNormal = `ppt.kategori_risiko = 'Rendah' OR (ppt.skor_total < 4 AND ppt.skor_total >= 0)`;
            filterAbnormalWithS2 = `ppt2.kategori_risiko = 'Tinggi' OR ppt2.skor_total >= 4`;
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            filterAbnormal = `git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'`;
            filterNormal = `git.hasil_pemeriksaan_mata = 'Normal' AND git.hasil_pemeriksaan_telinga = 'Normal'`;
            filterAbnormalWithS2 = `git2.hasil_pemeriksaan_mata <> 'Normal' OR git2.hasil_pemeriksaan_telinga <> 'Normal'`;
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
            filterAbnormal = `kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6`;
            filterNormal = `kjt.kategori_hasil = 'Normal' OR (kjt.skor_total < 6 AND kjt.skor_total >= 0)`;
            filterAbnormalWithS2 = `kjt2.kategori_hasil <> 'Normal' OR kjt2.skor_total >= 6`;
        }

        const levelFilter = levelWilayah === 'nagari' ? 'j.id_nagari' : 'j.id_jorong';

        // 1. Agregat Area ini
        const aggRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien) AS total_pasien,
                COUNT(s.id_skrining) AS total_kunjungan,
                COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) AS total_hipertensi,
                COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) AS terkendali
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            JOIN jorong j ON p.id_jorong = j.id_jorong
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(YEAR FROM s.tanggal_skrining) = $1
              AND s.id_jenis_ptm = $2
              AND ${levelFilter} = $3
        `, [tahunDipilih, jenisPtmTerpilih, areaId]);

        const agg = aggRes.rows[0];

        // 2. Daftar Pasien beserta Kunjungan dan Status Terakhir
        const patientsRes = await pool.query(`
            SELECT 
                p.id_pasien,
                p.nama_pasien,
                p.nik,
                p.jenis_kelamin,
                p.tahun_lahir,
                j.nama_jorong,
                COUNT(s.id_skrining) AS total_kunjungan,
                latest.is_abnormal,
                latest.sistole,
                latest.diastole,
                latest.gula_darah,
                latest.jenis_pemeriksaan,
                latest.dm_kategori,
                latest.imt,
                latest.kategori_obesitas,
                latest.ppok_skor,
                latest.ppok_risiko,
                latest.hasil_pemeriksaan_mata,
                latest.hasil_pemeriksaan_telinga,
                latest.jiwa_skor,
                latest.jiwa_kategori
            FROM pasien p
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN skrining s ON p.id_pasien = s.id_pasien
            LEFT JOIN LATERAL (
                SELECT 
                    s2.id_skrining,
                    CASE WHEN ${filterAbnormalWithS2} THEN true ELSE false END AS is_abnormal,
                    s2.sistole,
                    s2.diastole,
                    dmt2.gula_darah,
                    dmt2.jenis_pemeriksaan,
                    dmt2.kategori_hasil AS dm_kategori,
                    obt2.imt,
                    obt2.kategori_obesitas,
                    ppt2.skor_total AS ppok_skor,
                    ppt2.kategori_risiko AS ppok_risiko,
                    git2.hasil_pemeriksaan_mata,
                    git2.hasil_pemeriksaan_telinga,
                    kjt2.skor_total AS jiwa_skor,
                    kjt2.kategori_hasil AS jiwa_kategori
                FROM skrining s2
                LEFT JOIN skrining_hipertensi hp2 ON s2.id_skrining = hp2.id_skrining
                LEFT JOIN skrining_dm dmt2 ON s2.id_skrining = dmt2.id_skrining
                LEFT JOIN skrining_obesitas obt2 ON s2.id_skrining = obt2.id_skrining
                LEFT JOIN skrining_ppok ppt2 ON s2.id_skrining = ppt2.id_skrining
                LEFT JOIN skrining_gangguan_indra git2 ON s2.id_skrining = git2.id_skrining
                LEFT JOIN skrining_kesehatan_jiwa kjt2 ON s2.id_skrining = kjt2.id_skrining
                WHERE s2.id_pasien = p.id_pasien
                  AND s2.status_validasi = 'terverifikasi'
                  AND EXTRACT(YEAR FROM s2.tanggal_skrining) = $1
                  AND s2.id_jenis_ptm = $2
                ORDER BY s2.tanggal_skrining DESC
                LIMIT 1
            ) latest ON true
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(YEAR FROM s.tanggal_skrining) = $1
              AND s.id_jenis_ptm = $2
              AND ${levelFilter} = $3
            GROUP BY p.id_pasien, p.nama_pasien, p.nik, p.jenis_kelamin, p.tahun_lahir, j.nama_jorong, 
                     latest.is_abnormal,
                     latest.sistole,
                     latest.diastole,
                     latest.gula_darah,
                     latest.jenis_pemeriksaan,
                     latest.dm_kategori,
                     latest.imt,
                     latest.kategori_obesitas,
                     latest.ppok_skor,
                     latest.ppok_risiko,
                     latest.hasil_pemeriksaan_mata,
                     latest.hasil_pemeriksaan_telinga,
                     latest.jiwa_skor,
                     latest.jiwa_kategori
            ORDER BY p.nama_pasien ASC
        `, [tahunDipilih, jenisPtmTerpilih, areaId]);

        res.render('ptm/cetak_detail_wilayah', {
            tahunDipilih,
            levelWilayah,
            jenisPtmTerpilih,
            namaPtmTerpilih,
            namaWilayah,
            namaNagari,
            agg: {
                total_pasien: parseInt(agg.total_pasien) || 0,
                total_kunjungan: parseInt(agg.total_kunjungan) || 0,
                total_hipertensi: parseInt(agg.total_hipertensi) || 0,
                terkendali: parseInt(agg.terkendali) || 0
            },
            daftarPasien: patientsRes.rows,
            currentUser: req.session.user || null,
            tanggalCetak: new Date().toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
            })
        });
    } catch (err) {
        console.error('Error renderCetakDetailWilayah:', err);
        res.status(500).send('Gagal memuat halaman cetak detail wilayah: ' + err.message);
    }
};