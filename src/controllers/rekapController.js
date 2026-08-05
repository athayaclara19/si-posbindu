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
const NAMA_BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// Helper: menerjemahkan query filter (mode bulan / tahun / rentang) menjadi
// rentang tanggal (startDate - endDate) beserta label yang enak dibaca.
function resolvePeriodeFilter(query) {
    const now = new Date();
    const tahunIni = now.getFullYear();
    const bulanIni = now.getMonth() + 1;

    let mode = query.mode || 'bulan';
    if (!['bulan', 'tahun', 'rentang'].includes(mode)) mode = 'bulan';

    const tahun      = parseInt(query.tahun)       || tahunIni;
    const bulan      = parseInt(query.bulan)       || bulanIni;
    const tahunAwal  = parseInt(query.tahun_awal)  || tahunIni;
    const bulanAwal  = parseInt(query.bulan_awal)  || 1;
    const tahunAkhir = parseInt(query.tahun_akhir) || tahunIni;
    const bulanAkhir = parseInt(query.bulan_akhir) || bulanIni;

    let startDate, endDate, label, tahunUntukUmur;

    const lastDayOf = (y, m) => new Date(y, m, 0).getDate();
    const pad = (n) => String(n).padStart(2, '0');

    if (mode === 'tahun') {
        startDate = `${tahun}-01-01`;
        endDate   = `${tahun}-12-31`;
        label     = `Tahun ${tahun}`;
        tahunUntukUmur = tahun;
    } else if (mode === 'rentang') {
        startDate = `${tahunAwal}-${pad(bulanAwal)}-01`;
        endDate   = `${tahunAkhir}-${pad(bulanAkhir)}-${lastDayOf(tahunAkhir, bulanAkhir)}`;
        label     = (tahunAwal === tahunAkhir && bulanAwal === bulanAkhir)
            ? `${NAMA_BULAN[bulanAwal]} ${tahunAwal}`
            : `${NAMA_BULAN[bulanAwal]} ${tahunAwal} – ${NAMA_BULAN[bulanAkhir]} ${tahunAkhir}`;
        tahunUntukUmur = tahunAkhir;
    } else {
        // mode === 'bulan'
        startDate = `${tahun}-${pad(bulan)}-01`;
        endDate   = `${tahun}-${pad(bulan)}-${lastDayOf(tahun, bulan)}`;
        label     = `${NAMA_BULAN[bulan]} ${tahun}`;
        tahunUntukUmur = tahun;
    }

    const tahunOptions = [];
    for (let y = tahunIni - 1; y <= tahunIni + 2; y++) tahunOptions.push(y);

    return {
        mode, tahun, bulan, tahunAwal, bulanAwal, tahunAkhir, bulanAkhir,
        startDate, endDate, label, tahunUntukUmur,
        tahunIni, bulanIni, tahunOptions, NAMA_BULAN
    };
}

// Helper: filter SQL abnormal/normal berdasarkan jenis PTM terpilih.
function resolveFilterPtm(jenisPtmTerpilih) {
    let filterAbnormal = 's.sistole >= 140 OR s.diastole >= 90';
    let filterNormal   = 's.sistole < 140 AND s.diastole < 90';

    if (jenisPtmTerpilih === 'dm') {
        filterAbnormal = `dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s.gula_darah >= 140`;
        filterNormal   = `s.gula_darah < 140 AND dmt.kategori_hasil = 'Normal'`;
    } else if (jenisPtmTerpilih === 'obesitas') {
        filterAbnormal = `obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25`;
        filterNormal   = `obt.kategori_obesitas = 'Normal' OR (obt.imt < 25 AND obt.imt > 0)`;
    } else if (jenisPtmTerpilih === 'ppok') {
        filterAbnormal = `ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4`;
        filterNormal   = `ppt.kategori_risiko = 'Rendah' OR (ppt.skor_total < 4 AND ppt.skor_total >= 0)`;
    } else if (jenisPtmTerpilih === 'gangguan_indra') {
        filterAbnormal = `git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'`;
        filterNormal   = `git.hasil_pemeriksaan_mata = 'Normal' AND git.hasil_pemeriksaan_telinga = 'Normal'`;
    } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
        filterAbnormal = `kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6`;
        filterNormal   = `kjt.kategori_hasil = 'Normal' OR (kjt.skor_total < 6 AND kjt.skor_total >= 0)`;
    }
    return { filterAbnormal, filterNormal };
}

const JOIN_DETAIL_TABLES = `
    LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
    LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
    LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
    LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
    LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
    LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
`;

// 2. Rekap Gabungan (Periode + Wilayah) untuk PJ PTM (F.26-27)
exports.renderRekapPTM = async (req, res) => {
    try {
        const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';
        const levelWilayah = req.query.level || 'nagari';
        const pf = resolvePeriodeFilter(req.query);
        const { filterAbnormal, filterNormal } = resolveFilterPtm(jenisPtmTerpilih);

        const resJenisPtm = await pool.query(
            'SELECT id_jenis_ptm, nama_ptm FROM jenis_ptm ORDER BY nama_ptm'
        );
        const resActivePtm = await pool.query(
            'SELECT nama_ptm FROM jenis_ptm WHERE id_jenis_ptm = $1',
            [jenisPtmTerpilih]
        );
        const namaPtmTerpilih = resActivePtm.rows.length > 0 ? resActivePtm.rows[0].nama_ptm : 'Hipertensi';

        // A. Kartu ringkasan total (semua wilayah, sesuai rentang tanggal terpilih)
        const aggRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien) AS total_pasien,
                COUNT(s.id_skrining) AS total_kunjungan,
                COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) AS total_hipertensi,
                COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) AS terkendali
            FROM skrining s
            ${JOIN_DETAIL_TABLES}
            WHERE s.status_validasi = 'terverifikasi'
              AND s.tanggal_skrining BETWEEN $1 AND $2
              AND s.id_jenis_ptm = $3
        `, [pf.startDate, pf.endDate, jenisPtmTerpilih]);
        const agg = aggRes.rows[0];

        // B. Tabel rekap per wilayah (nagari / jorong), sesuai rentang tanggal terpilih
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
                    AND s.tanggal_skrining BETWEEN $1 AND $2
                    AND s.id_jenis_ptm = $3
                ${JOIN_DETAIL_TABLES}
                WHERE n.is_active = true
                GROUP BY n.id_nagari, n.nama_nagari
                ORDER BY n.nama_nagari ASC
            `;
            const result = await pool.query(query, [pf.startDate, pf.endDate, jenisPtmTerpilih]);
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
                    AND s.tanggal_skrining BETWEEN $1 AND $2
                    AND s.id_jenis_ptm = $3
                ${JOIN_DETAIL_TABLES}
                WHERE n.is_active = true
                GROUP BY j.id_jorong, j.nama_jorong, n.nama_nagari
                ORDER BY n.nama_nagari ASC, j.nama_jorong ASC
            `;
            const result = await pool.query(query, [pf.startDate, pf.endDate, jenisPtmTerpilih]);
            rekapWilayah = result.rows;
        }

        res.render('ptm/rekapptm', {
            rekapWilayah,
            agg: {
                total_pasien: parseInt(agg.total_pasien) || 0,
                total_kunjungan: parseInt(agg.total_kunjungan) || 0,
                total_hipertensi: parseInt(agg.total_hipertensi) || 0,
                terkendali: parseInt(agg.terkendali) || 0
            },
            active: 'rekap',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm',
            jenisPtmList: resJenisPtm.rows,
            jenisPtmTerpilih,
            namaPtmTerpilih,
            levelWilayah,
            ...pf
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat halaman rekapitulasi PTM.");
    }
};

// 3. Halaman cetak rekap gabungan (per wilayah, sesuai filter periode terpilih)
exports.renderCetakRekapWilayah = async (req, res) => {
    const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';
    const levelWilayah = req.query.level || 'nagari';
    const pf = resolvePeriodeFilter(req.query);

    try {
        const resActivePtm = await pool.query(
            'SELECT nama_ptm FROM jenis_ptm WHERE id_jenis_ptm = $1',
            [jenisPtmTerpilih]
        );
        const namaPtmTerpilih = resActivePtm.rows.length > 0 ? resActivePtm.rows[0].nama_ptm : 'Hipertensi';

        const { filterAbnormal, filterNormal } = resolveFilterPtm(jenisPtmTerpilih);

        // 1. Agregat Total
        const aggRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien) AS total_pasien,
                COUNT(s.id_skrining) AS total_kunjungan,
                COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) AS total_hipertensi,
                COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) AS terkendali
            FROM skrining s
            ${JOIN_DETAIL_TABLES}
            WHERE s.status_validasi = 'terverifikasi'
              AND s.tanggal_skrining BETWEEN $1 AND $2
              AND s.id_jenis_ptm = $3
        `, [pf.startDate, pf.endDate, jenisPtmTerpilih]);
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
                    AND s.tanggal_skrining BETWEEN $1 AND $2
                    AND s.id_jenis_ptm = $3
                ${JOIN_DETAIL_TABLES}
                WHERE n.is_active = true
                GROUP BY n.id_nagari, n.nama_nagari
                ORDER BY n.nama_nagari ASC
            `;
            const result = await pool.query(query, [pf.startDate, pf.endDate, jenisPtmTerpilih]);
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
                    AND s.tanggal_skrining BETWEEN $1 AND $2
                    AND s.id_jenis_ptm = $3
                ${JOIN_DETAIL_TABLES}
                WHERE n.is_active = true
                GROUP BY j.id_jorong, j.nama_jorong, n.nama_nagari
                ORDER BY n.nama_nagari ASC, j.nama_jorong ASC
            `;
            const result = await pool.query(query, [pf.startDate, pf.endDate, jenisPtmTerpilih]);
            rekapWilayah = result.rows;
        }

        res.render('ptm/cetak_rekap_wilayah', {
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
            }),
            ...pf
        });
    } catch (err) {
        console.error('Error renderCetakRekapWilayah:', err);
        res.status(500).send('Gagal memuat halaman cetak rekap wilayah: ' + err.message);
    }
};

exports.renderCetakDetailWilayah = async (req, res) => {
    const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';
    const levelWilayah = req.query.level || 'nagari';
    const areaId = req.query.id;
    const pf = resolvePeriodeFilter(req.query);

    try {
        if (!areaId) {
            return res.status(400).send('ID wilayah tidak valid.');
        }

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

        const { filterAbnormal, filterNormal } = resolveFilterPtm(jenisPtmTerpilih);
        let filterAbnormalWithS2 = 's2.sistole >= 140 OR s2.diastole >= 90';
        if (jenisPtmTerpilih === 'dm') {
            filterAbnormalWithS2 = `dmt2.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s2.gula_darah >= 140`;
        } else if (jenisPtmTerpilih === 'obesitas') {
            filterAbnormalWithS2 = `obt2.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt2.imt >= 25`;
        } else if (jenisPtmTerpilih === 'ppok') {
            filterAbnormalWithS2 = `ppt2.kategori_risiko = 'Tinggi' OR ppt2.skor_total >= 4`;
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            filterAbnormalWithS2 = `git2.hasil_pemeriksaan_mata <> 'Normal' OR git2.hasil_pemeriksaan_telinga <> 'Normal'`;
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
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
            ${JOIN_DETAIL_TABLES}
            WHERE s.status_validasi = 'terverifikasi'
              AND s.tanggal_skrining BETWEEN $1 AND $2
              AND s.id_jenis_ptm = $3
              AND ${levelFilter} = $4
        `, [pf.startDate, pf.endDate, jenisPtmTerpilih, areaId]);

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
                  AND s2.tanggal_skrining BETWEEN $1 AND $2
                  AND s2.id_jenis_ptm = $3
                ORDER BY s2.tanggal_skrining DESC
                LIMIT 1
            ) latest ON true
            WHERE s.status_validasi = 'terverifikasi'
              AND s.tanggal_skrining BETWEEN $1 AND $2
              AND s.id_jenis_ptm = $3
              AND ${levelFilter} = $4
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
        `, [pf.startDate, pf.endDate, jenisPtmTerpilih, areaId]);

        res.render('ptm/cetak_detail_wilayah', {
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
            }),
            tahunDipilih: pf.tahunUntukUmur,
            ...pf
        });
    } catch (err) {
        console.error('Error renderCetakDetailWilayah:', err);
        res.status(500).send('Gagal memuat halaman cetak detail wilayah: ' + err.message);
    }
};
