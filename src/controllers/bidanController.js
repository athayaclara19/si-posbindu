const pool    = require('../config/db');
const ExcelJS = require('exceljs');
 
// 1. Dashboard Bidan
exports.renderDashboard = async (req, res) => {
    try {
        const menunggu      = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='menunggu'");
        const terverifikasi = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='terverifikasi'");
        // FIX: gunakan 'revisi' bukan 'ditolak' — konsisten dengan kaderControllers.js
        const ditolak       = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='revisi'");
        
        const jumlahMenunggu      = parseInt(menunggu.rows[0].count) || 0;
        const jumlahTerverifikasi = parseInt(terverifikasi.rows[0].count) || 0;
        const jumlahDitolak       = parseInt(ditolak.rows[0].count) || 0;
        const totalData           = jumlahMenunggu + jumlahTerverifikasi + jumlahDitolak;

        const queryAntrean = `
            SELECT p.nama_pasien, k.tanggal_kegiatan, j.nama_jorong,
                   string_agg(jp.nama_ptm, ', ') AS ptm_list
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            LEFT JOIN jenis_ptm jp ON s.id_jenis_ptm = jp.id_jenis_ptm
            WHERE s.status_validasi = 'menunggu'
            GROUP BY p.id_pasien, p.nama_pasien, k.tanggal_kegiatan, j.nama_jorong
            ORDER BY k.tanggal_kegiatan ASC
            LIMIT 3
        `;
        const antreanResult = await pool.query(queryAntrean);

        const queryJorong = `
            SELECT 
                j.nama_jorong, 
                COUNT(s.id_skrining) AS total_pasien,
                COUNT(CASE WHEN s.status_validasi = 'menunggu' THEN 1 END) AS menunggu,
                COUNT(CASE WHEN s.id_jenis_ptm = 'hipertensi' AND (hp.status_tekanan <> 'Normal' OR s.sistole >= 140 OR s.diastole >= 90) THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN s.id_jenis_ptm = 'dm' AND (dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR dmt.gula_darah >= 140) THEN 1 END) AS dm,
                COUNT(CASE WHEN s.id_jenis_ptm = 'obesitas' AND (obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25) THEN 1 END) AS obesitas,
                COUNT(CASE WHEN s.id_jenis_ptm = 'ppok' AND (ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4) THEN 1 END) AS ppok,
                COUNT(CASE WHEN s.id_jenis_ptm = 'gangguan_indra' AND (git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal') THEN 1 END) AS gangguan_indra,
                COUNT(CASE WHEN s.id_jenis_ptm = 'kesehatan_jiwa' AND (kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6) THEN 1 END) AS kesehatan_jiwa
            FROM jorong j
            LEFT JOIN pasien p ON j.id_jorong = p.id_jorong
            LEFT JOIN skrining s ON p.id_pasien = s.id_pasien
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            GROUP BY j.nama_jorong
            ORDER BY j.nama_jorong
        `;
        const jorongStats = await pool.query(queryJorong);

        const queryPtmStats = `
            SELECT 
                COUNT(CASE WHEN id_jenis_ptm = 'hipertensi' THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN id_jenis_ptm = 'dm' THEN 1 END) AS dm,
                COUNT(CASE WHEN id_jenis_ptm = 'obesitas' THEN 1 END) AS obesitas,
                COUNT(CASE WHEN id_jenis_ptm = 'ppok' THEN 1 END) AS ppok,
                COUNT(CASE WHEN id_jenis_ptm = 'gangguan_indra' THEN 1 END) AS gangguan_indra,
                COUNT(CASE WHEN id_jenis_ptm = 'kesehatan_jiwa' THEN 1 END) AS kesehatan_jiwa,
                COUNT(id_skrining) AS total
            FROM skrining
        `;
        const ptmStats = await pool.query(queryPtmStats);

        // FIX: tambahkan currentUser dan role agar header tidak error
        res.render('bidan/dashboardbidan', {
            active: 'dashboard',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'bidan',
            totalData,
            jumlahMenunggu,
            jumlahTerverifikasi,
            jumlahDitolak,
            antreanValidasi: antreanResult.rows,
            jorongStats: jorongStats.rows,
            ptmStats: ptmStats.rows[0],
            successMessage: req.session.successMessage || null,
            errorMessage:   req.session.errorMessage   || null,
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat dashboard bidan.");
    }
};
 
// 2. Daftar Antrean Validasi
exports.renderValidasi = async (req, res) => {
    try {
        const query = `
            SELECT s.id_pasien, s.id_kegiatan, k.tanggal_kegiatan, p.nama_pasien, p.nik, p.alamat, j.nama_jorong, uk.nama_user AS nama_kader,
                   json_agg(json_build_object(
                       'id_skrining', s.id_skrining,
                       'id_jenis_ptm', s.id_jenis_ptm,
                       'nama_ptm', jp.nama_ptm,
                       'status_validasi', s.status_validasi,
                       'sistole', s.sistole,
                       'diastole', s.diastole,
                       'berat_badan', s.berat_badan,
                       'tinggi_badan', s.tinggi_badan,
                       'gula_darah', s.gula_darah,
                       'merokok', s.merokok,
                       'aktivitas_fisik', s.aktivitas_fisik,
                       'edukasi', s.edukasi,
                       'dapat_obat', s.dapat_obat,
                       'status_rujukan', s.status_rujukan,
                       'ht_status_tekanan', hp.status_tekanan,
                       'dm_gula_darah', dmt.gula_darah,
                       'dm_jenis_pemeriksaan', dmt.jenis_pemeriksaan,
                       'dm_kategori_hasil', dmt.kategori_hasil,
                       'ob_berat_badan', obt.berat_badan,
                       'ob_tinggi_badan', obt.tinggi_badan,
                       'ob_imt', obt.imt,
                       'ob_lingkar_perut', obt.lingkar_perut,
                       'ob_kategori_obesitas', obt.kategori_obesitas,
                       'pp_rokok_per_hari', ppt.jumlah_batang_rokok_per_hari,
                       'pp_lama_merokok', ppt.lama_tahun_merokok,
                       'pp_sesak_napas', ppt.sesak_napas,
                       'pp_batuk_kronis', ppt.batuk_berdahak_kronis,
                       'pp_skor_total', ppt.skor_total,
                       'pp_kategori_risiko', ppt.kategori_risiko,
                       'gi_mata', git.hasil_pemeriksaan_mata,
                       'gi_telinga', git.hasil_pemeriksaan_telinga,
                       'gi_keterangan', git.keterangan,
                       'kj_skor_total', kjt.skor_total,
                       'kj_kategori_hasil', kjt.kategori_hasil,
                       'kj_risiko_bunuh_diri', kjt.indikasi_risiko_bunuh_diri
                   )) AS pemeriksaan
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            LEFT JOIN "user" uk ON s.id_kader = uk.id_user
            LEFT JOIN jenis_ptm jp ON s.id_jenis_ptm = jp.id_jenis_ptm
            LEFT JOIN skrining_hipertensi hp   ON hp.id_skrining  = s.id_skrining
            LEFT JOIN skrining_dm dmt          ON dmt.id_skrining = s.id_skrining
            LEFT JOIN skrining_obesitas obt    ON obt.id_skrining = s.id_skrining
            LEFT JOIN skrining_ppok ppt        ON ppt.id_skrining = s.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
            WHERE s.status_validasi = 'menunggu'
            GROUP BY s.id_pasien, s.id_kegiatan, k.tanggal_kegiatan, p.nama_pasien, p.nik, p.alamat, j.nama_jorong, uk.nama_user
            ORDER BY k.tanggal_kegiatan ASC
        `;
        const result = await pool.query(query);
        res.render('bidan/validasi', {
            menungguValidasi: result.rows,
            active: 'validasi',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'bidan'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat antrean validasi.");
    }
};
 
// 3. Proses Validasi (Terima / Tolak)
exports.handleActionValidasi = async (req, res) => {
    try {
        const { id_skrining } = req.params;
        const { status_validasi, catatan_bidan } = req.body;
        
        const id_validator = req.session.user ? req.session.user.id_user : null;

        // FIX: 'revisi' disimpan sebagai 'revisi' (bukan 'ditolak')
        // agar konsisten dengan query di kaderControllers.js
        const statusMap = {
            'terverifikasi': 'terverifikasi',
            'Valid':         'terverifikasi',
            'revisi':        'revisi',
            'ditolak':       'revisi',
        };

        const finalStatus = statusMap[status_validasi] || null;

        if (!finalStatus) {
            return res.status(400).send(`Status validasi tidak valid: "${status_validasi}".`);
        }

        const query = `
            UPDATE skrining
            SET status_validasi=$1, catatan_bidan=$2,
                id_validator=$3, tanggal_validasi=NOW()
            WHERE id_pasien = (SELECT id_pasien FROM skrining WHERE id_skrining = $4)
              AND id_kegiatan = (SELECT id_kegiatan FROM skrining WHERE id_skrining = $4)
              AND status_validasi = 'menunggu'
        `;
        
        await pool.query(query, [finalStatus, catatan_bidan || null, id_validator, id_skrining]);
        res.redirect('/bidan/validasi');

    } catch (err) {
        console.error("ERROR SAAT VALIDASI:", err);
        res.status(500).send("Gagal memproses validasi. Penyebab: " + err.message);
    }
};
 
// 4. Halaman Laporan Bidan
exports.renderLaporan = async (req, res) => {
    try {
        // --- Ambil parameter pencarian, filter, & pagination dari query string ---
        const search       = (req.query.search || '').trim();
        const nagariFilter = (req.query.nagari || '').trim();   // id_nagari
        const jorongFilter = (req.query.jorong || '').trim();   // id_jorong
        let ptmFilter      = (req.query.ptm || '').trim();      // id_jenis_ptm (hipertensi, dm, dll.)
        const statusFilter = (req.query.status || '').trim();   // status specific to PTM
        const page         = Math.max(1, parseInt(req.query.page) || 1);
        const limit         = 20;
        const offset         = (page - 1) * limit;

        if (ptmFilter === '') ptmFilter = 'all';

        // --- Bangun kondisi WHERE secara dinamis ---
        const conditions  = [`s.status_validasi = 'terverifikasi'`];
        const queryParams = [];

        if (search !== '') {
            queryParams.push(`%${search}%`);
            conditions.push(`(p.nama_pasien ILIKE $${queryParams.length} OR p.nik ILIKE $${queryParams.length})`);
        }
        if (nagariFilter !== '') {
            queryParams.push(nagariFilter);
            conditions.push(`j.id_nagari = $${queryParams.length}`);
        }
        if (jorongFilter !== '') {
            queryParams.push(jorongFilter);
            conditions.push(`p.id_jorong = $${queryParams.length}`);
        }
        if (ptmFilter !== 'all') {
            queryParams.push(ptmFilter);
            conditions.push(`s.id_jenis_ptm = $${queryParams.length}`);
        }

        if (statusFilter !== '') {
            if (ptmFilter === 'hipertensi' || ptmFilter === 'all') {
                const map = {
                    normal: 's.sistole < 120 AND s.diastole < 80',
                    pra:    '(s.sistole >= 120 AND s.sistole < 140) OR (s.diastole >= 80 AND s.diastole < 90)',
                    ht1:    '(s.sistole >= 140 AND s.sistole < 160) OR (s.diastole >= 90 AND s.diastole < 100)',
                    ht2:    '(s.sistole >= 160 AND s.sistole < 180) OR (s.diastole >= 100 AND s.diastole < 110)',
                    krisis: 's.sistole >= 180 OR s.diastole >= 110'
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'dm') {
                const map = {
                    normal: "dmt.kategori_hasil = 'Normal'",
                    prediabetes: "dmt.kategori_hasil = 'Prediabetes'",
                    dm: "dmt.kategori_hasil = 'Diabetes Melitus'"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'obesitas') {
                const map = {
                    normal: "obt.kategori_obesitas = 'Normal'",
                    overweight: "obt.kategori_obesitas = 'Overweight'",
                    obesitas: "obt.kategori_obesitas = 'Obesitas'"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'ppok') {
                const map = {
                    rendah: "ppt.kategori_risiko = 'Rendah'",
                    tinggi: "ppt.kategori_risiko = 'Tinggi'"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'gangguan_indra') {
                const map = {
                    normal: "git.hasil_pemeriksaan_mata = 'Normal' AND git.hasil_pemeriksaan_telinga = 'Normal'",
                    gangguan: "git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'kesehatan_jiwa') {
                const map = {
                    normal: "kjt.kategori_hasil = 'Normal'",
                    masalah_jiwa: "kjt.kategori_hasil = 'Masalah Kesehatan Jiwa'",
                    bunuh_diri: "kjt.indikasi_risiko_bunuh_diri = true"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            }
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        // --- Hitung total data (untuk pagination) ---
        const countQuery = `
            SELECT COUNT(DISTINCT s.id_pasien)
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            LEFT JOIN skrining_hipertensi hp   ON hp.id_skrining  = s.id_skrining
            LEFT JOIN skrining_dm dmt          ON dmt.id_skrining = s.id_skrining
            LEFT JOIN skrining_obesitas obt    ON obt.id_skrining = s.id_skrining
            LEFT JOIN skrining_ppok ppt        ON ppt.id_skrining = s.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const totalData   = parseInt(countResult.rows[0].count);
        const totalPages  = Math.max(1, Math.ceil(totalData / limit));

        let laporanData = [];
        if (totalData > 0) {
            const limitIdx  = queryParams.length + 1;
            const offsetIdx = queryParams.length + 2;
            const pageParams = [...queryParams, limit, offset];

            const patientIdsResult = await pool.query(`
                SELECT s.id_pasien, MAX(k.tanggal_kegiatan) AS max_date
                FROM skrining s
                JOIN pasien p ON s.id_pasien = p.id_pasien
                JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                JOIN jorong j ON p.id_jorong = j.id_jorong
                LEFT JOIN skrining_hipertensi hp   ON hp.id_skrining  = s.id_skrining
                LEFT JOIN skrining_dm dmt          ON dmt.id_skrining = s.id_skrining
                LEFT JOIN skrining_obesitas obt    ON obt.id_skrining = s.id_skrining
                LEFT JOIN skrining_ppok ppt        ON ppt.id_skrining = s.id_skrining
                LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
                LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
                ${whereClause}
                GROUP BY s.id_pasien
                ORDER BY max_date DESC
                LIMIT $${limitIdx} OFFSET $${offsetIdx}
            `, pageParams);

            const patientIds = patientIdsResult.rows.map(r => r.id_pasien);

            if (patientIds.length > 0) {
                const anyIdx = queryParams.length + 1;
                const query = `
                    SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
                           json_agg(json_build_object(
                               'id_kegiatan', sub.id_kegiatan,
                               'tanggal_kegiatan', sub.tanggal_kegiatan,
                               'pemeriksaan', sub.pemeriksaan
                           ) ORDER BY sub.tanggal_kegiatan DESC) AS kunjungan
                    FROM (
                        SELECT s.id_pasien, s.id_kegiatan, k.tanggal_kegiatan,
                               json_agg(json_build_object(
                                   'id_skrining', s.id_skrining,
                                   'id_jenis_ptm', s.id_jenis_ptm,
                                   'nama_ptm', jp.nama_ptm,
                                   'status_validasi', s.status_validasi,
                                   'sistole', s.sistole,
                                   'diastole', s.diastole,
                                   'berat_badan', s.berat_badan,
                                   'tinggi_badan', s.tinggi_badan,
                                   'gula_darah', s.gula_darah,
                                   'merokok', s.merokok,
                                   'aktivitas_fisik', s.aktivitas_fisik,
                                   'edukasi', s.edukasi,
                                   'dapat_obat', s.dapat_obat,
                                   'status_rujukan', s.status_rujukan,
                                   'ht_status_tekanan', hp.status_tekanan,
                                   'dm_gula_darah', dmt.gula_darah,
                                   'dm_jenis_pemeriksaan', dmt.jenis_pemeriksaan,
                                   'dm_kategori_hasil', dmt.kategori_hasil,
                                   'ob_berat_badan', obt.berat_badan,
                                   'ob_tinggi_badan', obt.tinggi_badan,
                                   'ob_imt', obt.imt,
                                   'ob_lingkar_perut', obt.lingkar_perut,
                                   'ob_kategori_obesitas', obt.kategori_obesitas,
                                   'pp_rokok_per_hari', ppt.jumlah_batang_rokok_per_hari,
                                   'pp_lama_merokok', ppt.lama_tahun_merokok,
                                   'pp_sesak_napas', ppt.sesak_napas,
                                   'pp_batuk_kronis', ppt.batuk_berdahak_kronis,
                                   'pp_skor_total', ppt.skor_total,
                                   'pp_kategori_risiko', ppt.kategori_risiko,
                                   'gi_mata', git.hasil_pemeriksaan_mata,
                                   'gi_telinga', git.hasil_pemeriksaan_telinga,
                                   'gi_keterangan', git.keterangan,
                                   'kj_skor_total', kjt.skor_total,
                                   'kj_kategori_hasil', kjt.kategori_hasil,
                                   'kj_risiko_bunuh_diri', kjt.indikasi_risiko_bunuh_diri
                               )) AS pemeriksaan
                        FROM skrining s
                        JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                        LEFT JOIN jenis_ptm jp ON s.id_jenis_ptm = jp.id_jenis_ptm
                        LEFT JOIN skrining_hipertensi hp   ON hp.id_skrining  = s.id_skrining
                        LEFT JOIN skrining_dm dmt          ON dmt.id_skrining = s.id_skrining
                        LEFT JOIN skrining_obesitas obt    ON obt.id_skrining = s.id_skrining
                        LEFT JOIN skrining_ppok ppt        ON ppt.id_skrining = s.id_skrining
                        LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
                        LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
                        ${whereClause}
                        GROUP BY s.id_pasien, s.id_kegiatan, k.tanggal_kegiatan
                    ) sub
                    JOIN pasien p ON sub.id_pasien = p.id_pasien
                    JOIN jorong j ON p.id_jorong = j.id_jorong
                    WHERE p.id_pasien = ANY($${anyIdx})
                    GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
                    ORDER BY MAX(sub.tanggal_kegiatan) DESC
                `;
                const dataResult = await pool.query(query, [...queryParams, patientIds]);
                laporanData = dataResult.rows;
            }
        }

        // --- Data jorong & nagari untuk dropdown filter ---
        const jorong = await pool.query('SELECT id_jorong, nama_jorong, id_nagari FROM jorong ORDER BY nama_jorong ASC');
        const nagari = await pool.query('SELECT id_nagari, nama_nagari FROM nagari ORDER BY nama_nagari ASC');
        const listJenisPtm = await pool.query('SELECT id_jenis_ptm, nama_ptm FROM jenis_ptm ORDER BY nama_ptm ASC');

        res.render('bidan/laporan', {
            laporanData,
            jorong: jorong.rows,
            nagari: nagari.rows,
            jenisPtm: listJenisPtm.rows,
            active: 'laporan',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'bidan',
            // Data pencarian, filter & pagination untuk view
            search,
            selectedNagari: nagariFilter,
            selectedJorong: jorongFilter,
            selectedPtm: ptmFilter,
            selectedStatus: statusFilter,
            page,
            totalPages,
            totalData,
            limit,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat laporan.");
    }
};

// 5. Export Excel
exports.exportLaporanExcel = async (req, res) => {
    try {
        const search       = (req.query.search || '').trim();
        const nagariFilter = (req.query.nagari || '').trim();
        const jorongFilter = (req.query.jorong || '').trim();
        let ptmFilter      = (req.query.ptm || '').trim();
        const statusFilter = (req.query.status || '').trim();

        if (ptmFilter === '') ptmFilter = 'all';

        const conditions  = [`s.status_validasi = 'terverifikasi'`];
        const queryParams = [];

        if (search !== '') {
            queryParams.push(`%${search}%`);
            conditions.push(`(p.nama_pasien ILIKE $${queryParams.length} OR p.nik ILIKE $${queryParams.length})`);
        }
        if (nagariFilter !== '') {
            queryParams.push(nagariFilter);
            conditions.push(`j.id_nagari = $${queryParams.length}`);
        }
        if (jorongFilter !== '') {
            queryParams.push(jorongFilter);
            conditions.push(`p.id_jorong = $${queryParams.length}`);
        }
        if (ptmFilter !== 'all') {
            queryParams.push(ptmFilter);
            conditions.push(`s.id_jenis_ptm = $${queryParams.length}`);
        }

        if (statusFilter !== '') {
            if (ptmFilter === 'hipertensi' || ptmFilter === 'all') {
                const map = {
                    normal: 's.sistole < 120 AND s.diastole < 80',
                    pra:    '(s.sistole >= 120 AND s.sistole < 140) OR (s.diastole >= 80 AND s.diastole < 90)',
                    ht1:    '(s.sistole >= 140 AND s.sistole < 160) OR (s.diastole >= 90 AND s.diastole < 100)',
                    ht2:    '(s.sistole >= 160 AND s.sistole < 180) OR (s.diastole >= 100 AND s.diastole < 110)',
                    krisis: 's.sistole >= 180 OR s.diastole >= 110'
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'dm') {
                const map = {
                    normal: "dmt.kategori_hasil = 'Normal'",
                    prediabetes: "dmt.kategori_hasil = 'Prediabetes'",
                    dm: "dmt.kategori_hasil = 'Diabetes Melitus'"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'obesitas') {
                const map = {
                    normal: "obt.kategori_obesitas = 'Normal'",
                    overweight: "obt.kategori_obesitas = 'Overweight'",
                    obesitas: "obt.kategori_obesitas = 'Obesitas'"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'ppok') {
                const map = {
                    rendah: "ppt.kategori_risiko = 'Rendah'",
                    tinggi: "ppt.kategori_risiko = 'Tinggi'"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'gangguan_indra') {
                const map = {
                    normal: "git.hasil_pemeriksaan_mata = 'Normal' AND git.hasil_pemeriksaan_telinga = 'Normal'",
                    gangguan: "git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            } else if (ptmFilter === 'kesehatan_jiwa') {
                const map = {
                    normal: "kjt.kategori_hasil = 'Normal'",
                    masalah_jiwa: "kjt.kategori_hasil = 'Masalah Kesehatan Jiwa'",
                    bunuh_diri: "kjt.indikasi_risiko_bunuh_diri = true"
                };
                if (map[statusFilter]) conditions.push(map[statusFilter]);
            }
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        const query = `
            SELECT 
                p.nama_pasien, p.nik, j.nama_jorong, k.tanggal_kegiatan,
                MAX(hp.sistole) AS sistole,
                MAX(hp.diastole) AS diastole,
                MAX(hp.status_tekanan) AS status_tekanan,
                MAX(dmt.gula_darah) AS dm_gula_darah,
                MAX(dmt.jenis_pemeriksaan) AS dm_jenis_pemeriksaan,
                MAX(dmt.kategori_hasil) AS dm_kategori_hasil,
                MAX(obt.berat_badan) AS ob_berat_badan,
                MAX(obt.tinggi_badan) AS ob_tinggi_badan,
                MAX(obt.imt) AS ob_imt,
                MAX(obt.lingkar_perut) AS ob_lingkar_perut,
                MAX(obt.kategori_obesitas) AS ob_kategori_obesitas,
                MAX(ppt.jumlah_batang_rokok_per_hari) AS pp_rokok_per_hari,
                MAX(ppt.lama_tahun_merokok) AS pp_lama_merokok,
                MAX(CASE WHEN ppt.sesak_napas THEN 'Ya' ELSE 'Tidak' END) AS pp_sesak_napas,
                MAX(CASE WHEN ppt.batuk_berdahak_kronis THEN 'Ya' ELSE 'Tidak' END) AS pp_batuk_kronis,
                MAX(ppt.skor_total) AS pp_skor_total,
                MAX(ppt.kategori_risiko) AS pp_kategori_risiko,
                MAX(git.hasil_pemeriksaan_mata) AS gi_mata,
                MAX(git.hasil_pemeriksaan_telinga) AS gi_telinga,
                MAX(git.keterangan) AS gi_keterangan,
                MAX(kjt.skor_total) AS kj_skor_total,
                MAX(kjt.kategori_hasil) AS kj_kategori_hasil,
                MAX(CASE WHEN kjt.indikasi_risiko_bunuh_diri THEN 'Ya' ELSE 'Tidak' END) AS kj_risiko_bunuh_diri
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            LEFT JOIN skrining_hipertensi hp   ON hp.id_skrining  = s.id_skrining
            LEFT JOIN skrining_dm dmt          ON dmt.id_skrining = s.id_skrining
            LEFT JOIN skrining_obesitas obt    ON obt.id_skrining = s.id_skrining
            LEFT JOIN skrining_ppok ppt        ON ppt.id_skrining = s.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
            ${whereClause}
            GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong, k.tanggal_kegiatan
            ORDER BY k.tanggal_kegiatan ASC
        `;
        const result = await pool.query(query, queryParams);
        const workbook  = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Posbindu');
        worksheet.columns = [
            { header:'No',                          key:'no',                   width:5  },
            { header:'Tanggal',                     key:'tanggal',              width:12 },
            { header:'Nama Pasien',                 key:'nama_pasien',          width:22 },
            { header:'NIK',                         key:'nik',                  width:18 },
            { header:'Jorong',                      key:'jorong',               width:18 },
            { header:'Sistole (mmHg)',              key:'sistole',              width:12 },
            { header:'Diastole (mmHg)',             key:'diastole',             width:12 },
            { header:'Status TD',                   key:'status_td',            width:15 },
            { header:'Gula Darah (mg/dL)',          key:'gula_darah',           width:18 },
            { header:'Jenis GD',                    key:'jenis_gd',             width:15 },
            { header:'Status GD',                   key:'status_gd',            width:15 },
            { header:'BB (kg)',                     key:'bb',                   width:10 },
            { header:'TB (cm)',                     key:'tb',                   width:10 },
            { header:'IMT (kg/m²)',                 key:'imt',                  width:12 },
            { header:'Lingkar Perut (cm)',          key:'lp',                   width:15 },
            { header:'Status Obesitas',             key:'status_ob',            width:18 },
            { header:'Rokok/Hari',                  key:'rokok_hari',           width:12 },
            { header:'Lama Merokok (thn)',          key:'lama_merokok',         width:18 },
            { header:'Sesak Napas',                 key:'sesak',                width:12 },
            { header:'Batuk Kronis',                key:'batuk',                width:12 },
            { header:'Skor PUMA',                   key:'puma',                 width:12 },
            { header:'Status PPOK',                 key:'status_ppok',          width:15 },
            { header:'Pemeriksaan Mata',            key:'mata',                 width:18 },
            { header:'Pemeriksaan Telinga',         key:'telinga',              width:18 },
            { header:'Keterangan Indra',            key:'indra_ket',            width:20 },
            { header:'Skor SRQ-20',                 key:'srq',                  width:12 },
            { header:'Status Jiwa',                 key:'status_jiwa',          width:15 },
            { header:'Risiko Bunuh Diri',           key:'bunuh_diri',           width:18 },
        ];
        result.rows.forEach((row, i) => {
            let status_td = row.status_tekanan;
            if (!status_td && row.sistole) {
                status_td = 'Normal';
                if (row.sistole >= 180) status_td = 'Krisis';
                else if (row.sistole >= 160) status_td = 'HT Tkt.2';
                else if (row.sistole >= 140) status_td = 'HT Tkt.1';
                else if (row.sistole >= 120) status_td = 'Pra-HT';
            }
            worksheet.addRow({
                no: i+1,
                tanggal: new Date(row.tanggal_kegiatan).toLocaleDateString('id-ID'),
                nama_pasien: row.nama_pasien, 
                nik: row.nik, 
                jorong: row.nama_jorong,
                sistole: row.sistole || '-',
                diastole: row.diastole || '-',
                status_td: status_td || '-',
                gula_darah: row.dm_gula_darah || '-',
                jenis_gd: row.dm_jenis_pemeriksaan || '-',
                status_gd: row.dm_kategori_hasil || '-',
                bb: row.ob_berat_badan || '-',
                tb: row.ob_tinggi_badan || '-',
                imt: row.ob_imt ? parseFloat(row.ob_imt).toFixed(1) : '-',
                lp: row.ob_lingkar_perut || '-',
                status_ob: row.ob_kategori_obesitas || '-',
                rokok_hari: row.pp_rokok_per_hari ?? '-',
                lama_merokok: row.pp_lama_merokok ?? '-',
                sesak: row.pp_sesak_napas || '-',
                batuk: row.pp_batuk_kronis || '-',
                puma: row.pp_skor_total ?? '-',
                status_ppok: row.pp_kategori_risiko || '-',
                mata: row.gi_mata || '-',
                telinga: row.gi_telinga || '-',
                indra_ket: row.gi_keterangan || '-',
                srq: row.kj_skor_total ?? '-',
                status_jiwa: row.kj_kategori_hasil || '-',
                bunuh_diri: row.kj_risiko_bunuh_diri || '-',
            });
        });
        worksheet.getRow(1).font = { bold:true, color:{argb:'FFFFFFFF'} };
        worksheet.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2563EB'} };
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename=Laporan_Posbindu.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal mengekspor laporan: " + err.message);
    }
};
