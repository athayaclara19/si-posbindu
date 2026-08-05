const pool = require('../config/db');

// 1. Render Form Input Skrining
exports.renderInputSkrining = async (req, res) => {
    try {
        const pasien   = await pool.query('SELECT id_pasien, nama_pasien, nik, usia, tahun_lahir FROM pasien ORDER BY nama_pasien ASC');
        const kegiatan = await pool.query('SELECT id_kegiatan, lokasi, tanggal_kegiatan FROM kegiatan ORDER BY tanggal_kegiatan DESC');
        res.render('kader/skrining', {
            pasien: pasien.rows, kegiatan: kegiatan.rows,
            selectedPasienId: req.query.id_pasien || null,
            error: null, active: 'skrining',
            notifikasi: [],
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat data form skrining.");
    }
};

// 2. Proses Simpan Skrining Multi-PTM (POST)
exports.handleInputSkrining = async (req, res) => {
    const {
        id_pasien, id_kegiatan,
        merokok, aktivitas_fisik, edukasi, dapat_obat, status_rujukan,
        hipertensi = {}, dm = {}, obesitas = {}, ppok = {},
        gangguan_indra = {}, kesehatan_jiwa = {}
    } = req.body;

    const id_kader = req.session.user.id_user;

    const sistole  = parseInt(hipertensi.sistole || req.body.sistole);
    const diastole = parseInt(hipertensi.diastole || req.body.diastole);
    if (isNaN(sistole) || isNaN(diastole)) {
        return res.status(400).send("Gagal menyimpan data skrining: sistole/diastole wajib diisi (tab Hipertensi).");
    }

    const merokokBool = merokok === 'true' || merokok === true || merokok === 'on';
    const beratUmum  = obesitas.berat_badan || ppok.berat_badan || req.body.berat_badan || null;
    const tinggiUmum = obesitas.tinggi_badan || ppok.tinggi_badan || req.body.tinggi_badan || null;

    // Cek apakah pasien sudah pernah diskrining pada kegiatan ini
    try {
        const dupCheck = await pool.query(
            `SELECT id_skrining FROM skrining 
             WHERE id_pasien = $1 AND id_kegiatan = $2 LIMIT 1`,
            [id_pasien, id_kegiatan]
        );
        if (dupCheck && dupCheck.rows && dupCheck.rows.length > 0) {
            return res.status(400).send("Gagal menyimpan: Pasien ini sudah terdaftar mengikuti kegiatan skrining ini. Satu pasien hanya boleh diskrining sekali per kegiatan.");
        }
    } catch (err) {
        console.error("Error checking duplicate screening:", err);
        return res.status(500).send("Gagal memproses validasi data skrining: " + err.message);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertSkrining = async (idJenisPtm, overrides = {}) => {
            const q = `
                INSERT INTO skrining
                (id_pasien, id_kader, id_kegiatan, sistole, diastole,
                 berat_badan, tinggi_badan, gula_darah,
                 merokok, aktivitas_fisik, edukasi, dapat_obat, status_rujukan,
                 tanggal_skrining, status_validasi, id_jenis_ptm)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                        CURRENT_DATE, 'menunggu', $14)
                RETURNING id_skrining
            `;
            const vals = [
                id_pasien, id_kader, id_kegiatan,
                sistole, diastole,
                overrides.berat_badan ?? beratUmum,
                overrides.tinggi_badan ?? tinggiUmum,
                overrides.gula_darah ?? (dm.gula_darah || req.body.gula_darah || null),
                merokokBool,
                aktivitas_fisik || null,
                edukasi || null,
                dapat_obat || 'tidak',
                status_rujukan || 'tidak',
                idJenisPtm
            ];
            const result = await client.query(q, vals);
            return result.rows[0].id_skrining;
        };

        // 1. Hipertensi (selalu ada, karena tensi wajib diisi)
        const idHipertensi = await insertSkrining('hipertensi');
        await client.query(
            `INSERT INTO skrining_hipertensi (id_skrining, sistole, diastole, status_tekanan)
             VALUES ($1,$2,$3,$4)`,
            [idHipertensi, sistole, diastole, null]
        );

        // 2. Diabetes Melitus
        const gd = dm.gula_darah || req.body.gula_darah;
        if (gd) {
            const idDm = await insertSkrining('dm', { gula_darah: gd });
            await client.query(
                `INSERT INTO skrining_dm (id_skrining, gula_darah, jenis_pemeriksaan, kategori_hasil)
                 VALUES ($1,$2,$3,$4)`,
                [idDm, gd, dm.jenis_pemeriksaan || null, null]
            );
        }

        // 3. Obesitas
        const bb = obesitas.berat_badan || req.body.berat_badan;
        const tb = obesitas.tinggi_badan || req.body.tinggi_badan;
        if (bb && tb) {
            const idObesitas = await insertSkrining('obesitas', {
                berat_badan: bb, tinggi_badan: tb
            });
            const tbM = tb / 100;
            const imt = tbM > 0 ? (bb / (tbM * tbM)) : null;
            await client.query(
                `INSERT INTO skrining_obesitas (id_skrining, berat_badan, tinggi_badan, imt, lingkar_perut, kategori_obesitas)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [idObesitas, bb, tb, imt, obesitas.lingkar_perut || null, null]
            );
        }

        // 4. PPOK
        if (ppok.jumlah_batang_rokok_per_hari || ppok.sesak_napas || ppok.batuk_berdahak_kronis) {
            const idPpok = await insertSkrining('ppok', {
                berat_badan: ppok.berat_badan, tinggi_badan: ppok.tinggi_badan
            });
            let imtPpok = null;
            if (ppok.berat_badan && ppok.tinggi_badan) {
                const tbM = ppok.tinggi_badan / 100;
                imtPpok = tbM > 0 ? (ppok.berat_badan / (tbM * tbM)) : null;
            }
            await client.query(
                `INSERT INTO skrining_ppok
                 (id_skrining, berat_badan, tinggi_badan, imt, jumlah_batang_rokok_per_hari,
                  lama_tahun_merokok, sesak_napas, batuk_berdahak_kronis, skor_total,
                  kategori_risiko, rujukan_spirometri)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [
                    idPpok, ppok.berat_badan || null, ppok.tinggi_badan || null, imtPpok,
                    ppok.jumlah_batang_rokok_per_hari || 0, ppok.lama_tahun_merokok || 0,
                    ppok.sesak_napas === 'true' || ppok.sesak_napas === true,
                    ppok.batuk_berdahak_kronis === 'true' || ppok.batuk_berdahak_kronis === true,
                    ppok.skor_total || null, ppok.kategori_risiko || null,
                    ppok.rujukan_spirometri === 'true' || ppok.rujukan_spirometri === true
                ]
            );
        }

        // 5. Gangguan Indra
        if (gangguan_indra.hasil_mata || gangguan_indra.hasil_telinga || gangguan_indra.keterangan) {
            const idIndra = await insertSkrining('gangguan_indra');
            await client.query(
                `INSERT INTO skrining_gangguan_indra
                 (id_skrining, hasil_pemeriksaan_mata, tajam_penglihatan,
                  hasil_pemeriksaan_telinga, tes_pendengaran, keterangan, rujukan_lanjutan)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [
                    idIndra, gangguan_indra.hasil_mata || null, null,
                    gangguan_indra.hasil_telinga || null, null,
                    gangguan_indra.keterangan || null, false
                ]
            );
        }

        // 6. Kesehatan Jiwa (SRQ-20)
        const adaJawabanJiwa = Object.keys(kesehatan_jiwa).length > 0;
        if (adaJawabanJiwa) {
            const jawabanJiwa = [];
            for (let i = 1; i <= 20; i++) {
                const val = kesehatan_jiwa['j' + i];
                jawabanJiwa.push(val === 'true' || val === true);
            }
            const skorTotal = jawabanJiwa.filter(Boolean).length;
            const idJiwa = await insertSkrining('kesehatan_jiwa');
            await client.query(
                `INSERT INTO skrining_kesehatan_jiwa
                 (id_skrining, j1,j2,j3,j4,j5,j6,j7,j8,j9,j10,
                  j11,j12,j13,j14,j15,j16,j17,j18,j19,j20,
                  skor_total, kategori_hasil)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                         $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
                [idJiwa, ...jawabanJiwa, skorTotal, null]
            );
        }

        await client.query('COMMIT');
        res.redirect('/riwayat');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).send("Gagal menyimpan data skrining: " + err.message);
    } finally {
        client.release();
    }
};

// 3. Render Dashboard Kader
exports.renderDashboard = async (req, res) => {
    const id_kader   = req.session.user.id_user;
    const id_jorong  = req.session.user.id_jorong;
    try {
        // Total pasien terdaftar di jorong kader
        const totalPasien = await pool.query(
            "SELECT COUNT(*) FROM pasien WHERE id_jorong=$1", [id_jorong]);

        // Jumlah pasien baru bulan ini (dari skrining pertama kali bulan ini)
        const pasienBaru = await pool.query(
            `SELECT COUNT(DISTINCT s.id_pasien) FROM skrining s
             JOIN pasien p ON s.id_pasien = p.id_pasien
             WHERE p.id_jorong=$1
             AND EXTRACT(MONTH FROM s.tanggal_skrining)=EXTRACT(MONTH FROM CURRENT_DATE)
             AND EXTRACT(YEAR FROM s.tanggal_skrining)=EXTRACT(YEAR FROM CURRENT_DATE)`, [id_jorong]);

        // Skrining yang dibuat kader ini bulan ini
        const skriningBulanIni = await pool.query(
            `SELECT COUNT(*) FROM skrining WHERE id_kader=$1
             AND EXTRACT(MONTH FROM tanggal_skrining)=EXTRACT(MONTH FROM CURRENT_DATE)
             AND EXTRACT(YEAR FROM tanggal_skrining)=EXTRACT(YEAR FROM CURRENT_DATE)`, [id_kader]);

        // Pending validasi (menunggu)
        const menunggu = await pool.query(
            "SELECT COUNT(*) FROM skrining WHERE id_kader=$1 AND status_validasi='menunggu'", [id_kader]);

        // Perlu revisi (ditolak)
        const revisi = await pool.query(
            "SELECT COUNT(*) FROM skrining WHERE id_kader=$1 AND status_validasi='revisi'", [id_kader]);

        // Tren skrining 6 bulan terakhir
        const trenQuery = await pool.query(`
            SELECT TO_CHAR(tanggal_skrining, 'Mon') AS bulan,
                   EXTRACT(MONTH FROM tanggal_skrining) AS bulan_num,
                   EXTRACT(YEAR FROM tanggal_skrining) AS tahun,
                   COUNT(*) AS jumlah
            FROM skrining
            WHERE id_kader=$1
              AND tanggal_skrining >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
            GROUP BY bulan, bulan_num, tahun
            ORDER BY tahun ASC, bulan_num ASC`, [id_kader]);

        // Jadwal hari ini berdasarkan jorong kader
        const jadwalHariIni = await pool.query(`
            SELECT k.tanggal_kegiatan, k.lokasi, j.nama_jorong
            FROM kegiatan k
            JOIN jorong j ON k.id_jorong = j.id_jorong
            WHERE DATE(k.tanggal_kegiatan) = CURRENT_DATE
              AND k.id_jorong = $1
            ORDER BY k.tanggal_kegiatan ASC
            LIMIT 5`, [id_jorong]);

        // Notifikasi: skrining ditolak yang belum diperbaiki
        const notifRevisi = await pool.query(`
            SELECT s.id_skrining, p.nama_pasien, s.tanggal_skrining, s.catatan_bidan
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            WHERE s.id_kader=$1 AND s.status_validasi='revisi'
            ORDER BY s.tanggal_skrining DESC LIMIT 10`, [id_kader]);

        // Notifikasi: skrining terverifikasi terbaru (5 hari terakhir)
        const notifDisetujui = await pool.query(`
            SELECT s.id_skrining, p.nama_pasien, s.tanggal_skrining
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            WHERE s.id_kader=$1 AND s.status_validasi='terverifikasi'
            ORDER BY s.tanggal_skrining DESC LIMIT 10`, [id_kader]);

        const notifikasi = [
            ...notifRevisi.rows.map(n => ({
                tipe: 'revisi',
                pesan: `Skrining ${n.nama_pasien} ditolak: ${n.catatan_bidan || 'Perlu diperbaiki'}`,
                id_skrining: n.id_skrining
            })),
            ...notifDisetujui.rows.map(n => ({
                tipe: 'disetujui',
                pesan: `Skrining ${n.nama_pasien} telah disetujui`,
                id_skrining: n.id_skrining
            }))
        ];

        res.render('kader/dashboard', {
            active: 'dashboard',
            totalPasien: totalPasien.rows[0].count,
            pasienBaru: pasienBaru.rows[0].count,
            skriningBulanIni: skriningBulanIni.rows[0].count,
            menungguValidasi: menunggu.rows[0].count,
            perluRevisi: revisi.rows[0].count,
            trenSkrining: trenQuery.rows,
            jadwalHariIni: jadwalHariIni.rows,
            notifikasi: notifikasi,
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader',
            successMessage: req.session.successMessage || null,
            errorMessage:   req.session.errorMessage   || null,
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat dashboard: " + err.message);
    }
};

// 4. Render Riwayat Skrining
exports.renderRiwayat = async (req, res) => {
    const id_kader = req.session.user.id_user;
    try {
        const search     = (req.query.search || '').trim();
        const statusQ    = req.query.status  || '';
        const ptm        = req.query.ptm     || 'Semua';
        const page       = Math.max(1, parseInt(req.query.page) || 1);
        const limit      = 20;
        const offset     = (page - 1) * limit;

        // Bangun kondisi WHERE dinamis
        const conditions = ['s.id_kader = $1'];
        const params     = [id_kader];
        let   pi         = 2; // index parameter berikutnya

        if (search !== '') {
            conditions.push(`(p.nama_pasien ILIKE $${pi} OR p.nik ILIKE $${pi})`);
            params.push(`%${search}%`);
            pi++;
        }
        if (statusQ !== '' && statusQ !== 'Semua') {
            // Map label UI ke nilai DB
            const statusMap = {
                'Menunggu Validasi': 'menunggu',
                'Valid':             'terverifikasi',
                'Perlu Revisi':      'revisi',
            };
            const dbStatus = statusMap[statusQ];
            if (dbStatus) {
                conditions.push(`s.status_validasi = $${pi}`);
                params.push(dbStatus);
                pi++;
            }
        }
        if (ptm !== '' && ptm !== 'Semua') {
            conditions.push(`s.id_jenis_ptm = $${pi}`);
            params.push(ptm);
            pi++;
        }

        const whereClause = 'WHERE ' + conditions.join(' AND ');

        // Hitung total pasien (distinct id_pasien) untuk pagination
        const countResult = await pool.query(
            `SELECT COUNT(DISTINCT s.id_pasien) 
             FROM skrining s
             JOIN pasien p ON s.id_pasien = p.id_pasien
             ${whereClause}`, params);
        const totalData  = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalData / limit);

        let riwayat = [];
        if (totalData > 0) {
            // Ambil daftar id_pasien untuk halaman ini, urutkan berdasarkan tanggal skrining terbaru (max tanggal_kegiatan DESC)
            const patientIdsResult = await pool.query(`
                SELECT s.id_pasien, MAX(k.tanggal_kegiatan) AS max_date
                FROM skrining s
                JOIN pasien p ON s.id_pasien = p.id_pasien
                JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                ${whereClause}
                GROUP BY s.id_pasien
                ORDER BY max_date DESC
                LIMIT $${pi} OFFSET $${pi + 1}
            `, [...params, limit, offset]);

            const patientIds = patientIdsResult.rows.map(r => r.id_pasien);

            if (patientIds.length > 0) {
                // Ambil data kunjungan lengkap hanya untuk id_pasien yang terpilih
                const dataQuery = `
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
                                   'catatan_bidan', s.catatan_bidan,
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
                                   'tanggal_validasi', s.tanggal_validasi,
                                   'status_tekanan', s.status_tekanan,
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
                                   'pp_rujukan_spirometri', ppt.rujukan_spirometri,
                                   'gi_mata', git.hasil_pemeriksaan_mata,
                                   'gi_telinga', git.hasil_pemeriksaan_telinga,
                                   'gi_keterangan', git.keterangan,
                                   'kj_skor_total', kjt.skor_total,
                                   'kj_kategori_hasil', kjt.kategori_hasil,
                                   'kj_risiko_bunuh_diri', kjt.indikasi_risiko_bunuh_diri
                               )) AS pemeriksaan
                        FROM skrining s
                        JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                        JOIN pasien p ON s.id_pasien = p.id_pasien
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
                    WHERE p.id_pasien = ANY($${pi})
                    GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
                    ORDER BY MAX(sub.tanggal_kegiatan) DESC
                `;
                const dataResult = await pool.query(dataQuery, [...params, patientIds]);
                riwayat = dataResult.rows;
            }
        }

        res.render('kader/riwayat', {
            riwayat,
            active: 'riwayat',
            notifikasi: [],
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader',
            search,
            statusQ,
            ptm,
            page,
            totalPages,
            totalData,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat riwayat skrining.");
    }
};

// 5. Render Form Edit Skrining (untuk data yang ditolak bidan)
exports.renderEditSkrining = async (req, res) => {
    const { id_skrining } = req.params;
    try {
        const query = `
            SELECT s.*, p.nama_pasien, p.nik,
                   hp.status_tekanan   AS ht_status_tekanan,
                   dmt.gula_darah      AS dm_gula_darah,
                   dmt.jenis_pemeriksaan AS dm_jenis_pemeriksaan,
                   dmt.kategori_hasil  AS dm_kategori_hasil,
                   obt.berat_badan     AS ob_berat_badan,
                   obt.tinggi_badan    AS ob_tinggi_badan,
                   obt.imt             AS ob_imt,
                   obt.lingkar_perut   AS ob_lingkar_perut,
                   obt.kategori_obesitas AS ob_kategori_obesitas,
                   ppt.jumlah_batang_rokok_per_hari AS pp_rokok_per_hari,
                   ppt.lama_tahun_merokok AS pp_lama_merokok,
                   ppt.sesak_napas     AS pp_sesak_napas,
                   ppt.batuk_berdahak_kronis AS pp_batuk_kronis,
                   ppt.skor_total      AS pp_skor_total,
                   ppt.kategori_risiko AS pp_kategori_risiko,
                   ppt.rujukan_spirometri AS pp_rujukan_spirometri,
                   git.hasil_pemeriksaan_mata AS gi_mata,
                   git.hasil_pemeriksaan_telinga AS gi_telinga,
                   git.keterangan      AS gi_keterangan,
                   kjt.skor_total      AS kj_skor_total,
                   kjt.kategori_hasil  AS kj_kategori_hasil,
                   kjt.indikasi_risiko_bunuh_diri AS kj_risiko_bunuh_diri
            FROM skrining s 
            JOIN pasien p ON s.id_pasien = p.id_pasien
            LEFT JOIN skrining_hipertensi hp   ON hp.id_skrining  = s.id_skrining
            LEFT JOIN skrining_dm dmt          ON dmt.id_skrining = s.id_skrining
            LEFT JOIN skrining_obesitas obt    ON obt.id_skrining = s.id_skrining
            LEFT JOIN skrining_ppok ppt        ON ppt.id_skrining = s.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
            WHERE s.id_skrining = $1 AND s.status_validasi = 'revisi'
        `;
        const result = await pool.query(query, [id_skrining]);
        if (result.rows.length === 0) {
            return res.status(404).send("Data tidak ditemukan atau tidak dalam status ditolak.");
        }
        res.render('kader/edit_skrining', {
            skrining: result.rows[0],
            active: 'riwayat',
            notifikasi: [],
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat form edit.");
    }
};

// 6. Proses Simpan Edit Skrining (POST)
exports.handleEditSkrining = async (req, res) => {
    const { id_skrining } = req.params;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Dapatkan id_jenis_ptm untuk data skrining ini
        const checkRes = await client.query('SELECT id_jenis_ptm FROM skrining WHERE id_skrining = $1', [id_skrining]);
        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).send("Data tidak ditemukan.");
        }
        const { id_jenis_ptm } = checkRes.rows[0];
        
        // 2. Lakukan update spesifik berdasarkan PTM
        if (id_jenis_ptm === 'hipertensi') {
            const sistole = parseInt(req.body.sistole);
            const diastole = parseInt(req.body.diastole);
            
            await client.query(
                `UPDATE skrining 
                 SET sistole = $1, diastole = $2, status_validasi = 'menunggu', tanggal_validasi = NULL, catatan_bidan = NULL
                 WHERE id_skrining = $3`,
                [sistole, diastole, id_skrining]
            );
            
            await client.query(
                `UPDATE skrining_hipertensi 
                 SET sistole = $1, diastole = $2
                 WHERE id_skrining = $3`,
                [sistole, diastole, id_skrining]
            );
        } else if (id_jenis_ptm === 'dm') {
            const gd = parseInt(req.body.dm_gula_darah);
            const jenisPemeriksaan = req.body.dm_jenis_pemeriksaan || null;
            
            await client.query(
                `UPDATE skrining 
                 SET gula_darah = $1, status_validasi = 'menunggu', tanggal_validasi = NULL, catatan_bidan = NULL
                 WHERE id_skrining = $2`,
                [gd, id_skrining]
            );
            
            await client.query(
                `UPDATE skrining_dm 
                 SET gula_darah = $1, jenis_pemeriksaan = $2
                 WHERE id_skrining = $3`,
                [gd, jenisPemeriksaan, id_skrining]
            );
        } else if (id_jenis_ptm === 'obesitas') {
            const bb = parseFloat(req.body.ob_berat_badan);
            const tb = parseInt(req.body.ob_tinggi_badan);
            const lp = parseFloat(req.body.ob_lingkar_perut);
            const tbM = tb / 100;
            const imt = tbM > 0 ? (bb / (tbM * tbM)) : null;
            
            await client.query(
                `UPDATE skrining 
                 SET berat_badan = $1, tinggi_badan = $2, status_validasi = 'menunggu', tanggal_validasi = NULL, catatan_bidan = NULL
                 WHERE id_skrining = $3`,
                [bb, tb, id_skrining]
            );
            
            await client.query(
                `UPDATE skrining_obesitas 
                 SET berat_badan = $1, tinggi_badan = $2, imt = $3, lingkar_perut = $4
                 WHERE id_skrining = $5`,
                [bb, tb, imt, lp, id_skrining]
            );
        } else if (id_jenis_ptm === 'ppok') {
            const bb = parseFloat(req.body.pp_berat_badan) || null;
            const tb = parseInt(req.body.pp_tinggi_badan) || null;
            const rokok = parseInt(req.body.pp_rokok_per_hari) || 0;
            const lama = parseInt(req.body.pp_lama_merokok) || 0;
            const sesak = req.body.pp_sesak_napas === 'true' || req.body.pp_sesak_napas === true || req.body.pp_sesak_napas === 'on' || req.body.pp_sesak_napas === 'Ya';
            const batuk = req.body.pp_batuk_kronis === 'true' || req.body.pp_batuk_kronis === true || req.body.pp_batuk_kronis === 'on' || req.body.pp_batuk_kronis === 'Ya';
            const skor = parseInt(req.body.pp_skor_total) || 0;
            const kategori = req.body.pp_kategori_risiko || 'Rendah';
            const spirometri = req.body.pp_rujukan_spirometri === 'true' || req.body.pp_rujukan_spirometri === true || req.body.pp_rujukan_spirometri === 'on' || req.body.pp_rujukan_spirometri === 'Ya';
            
            let imt = null;
            if (bb && tb) {
                const tbM = tb / 100;
                imt = tbM > 0 ? (bb / (tbM * tbM)) : null;
            }
            
            await client.query(
                `UPDATE skrining 
                 SET berat_badan = $1, tinggi_badan = $2, status_validasi = 'menunggu', tanggal_validasi = NULL, catatan_bidan = NULL
                 WHERE id_skrining = $3`,
                [bb, tb, id_skrining]
            );
            
            await client.query(
                `UPDATE skrining_ppok 
                 SET berat_badan = $1, tinggi_badan = $2, imt = $3, jumlah_batang_rokok_per_hari = $4,
                     lama_tahun_merokok = $5, sesak_napas = $6, batuk_berdahak_kronis = $7, skor_total = $8,
                     kategori_risiko = $9, rujukan_spirometri = $10
                 WHERE id_skrining = $11`,
                [bb, tb, imt, rokok, lama, sesak, batuk, skor, kategori, spirometri, id_skrining]
            );
        } else if (id_jenis_ptm === 'gangguan_indra') {
            const mata = req.body.gi_mata || 'Normal';
            const telinga = req.body.gi_telinga || 'Normal';
            const ket = req.body.gi_keterangan || null;
            
            await client.query(
                `UPDATE skrining 
                 SET status_validasi = 'menunggu', tanggal_validasi = NULL, catatan_bidan = NULL
                 WHERE id_skrining = $1`,
                [id_skrining]
            );
            
            await client.query(
                `UPDATE skrining_gangguan_indra 
                 SET hasil_pemeriksaan_mata = $1, hasil_pemeriksaan_telinga = $2, keterangan = $3
                 WHERE id_skrining = $4`,
                [mata, telinga, ket, id_skrining]
            );
        } else if (id_jenis_ptm === 'kesehatan_jiwa') {
            const skor = parseInt(req.body.kj_skor_total) || 0;
            const hasil = req.body.kj_kategori_hasil || 'Normal';
            const bunuhDiri = req.body.kj_risiko_bunuh_diri === 'Ya' || req.body.kj_risiko_bunuh_diri === 'true' || req.body.kj_risiko_bunuh_diri === true || req.body.kj_risiko_bunuh_diri === 'on';
            
            await client.query(
                `UPDATE skrining 
                 SET status_validasi = 'menunggu', tanggal_validasi = NULL, catatan_bidan = NULL
                 WHERE id_skrining = $1`,
                [id_skrining]
            );
            
            await client.query(
                `UPDATE skrining_kesehatan_jiwa 
                 SET skor_total = $1, kategori_hasil = $2, indikasi_risiko_bunuh_diri = $3
                 WHERE id_skrining = $4`,
                [skor, hasil, bunuhDiri, id_skrining]
            );
        }
        
        // 3. Update parameter umum gaya hidup & rujukan jika dikirim
        if (req.body.merokok || req.body.aktivitas_fisik || req.body.edukasi || req.body.dapat_obat || req.body.status_rujukan) {
            await client.query(
                `UPDATE skrining 
                 SET merokok = $1, aktivitas_fisik = $2, edukasi = $3, dapat_obat = $4, status_rujukan = $5
                 WHERE id_skrining = $6`,
                [
                    req.body.merokok === 'true' || req.body.merokok === true || req.body.merokok === 'on' || req.body.merokok === 'Ya',
                    req.body.aktivitas_fisik || null,
                    req.body.edukasi || null,
                    req.body.dapat_obat || 'tidak',
                    req.body.status_rujukan || 'tidak',
                    id_skrining
                ]
            );
        }
        
        await client.query('COMMIT');
        res.redirect('/riwayat');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).send("Gagal menyimpan perubahan: " + err.message);
    } finally {
        client.release();
    }
};

// 6. Cetak Bukti Skrining Pasien
exports.renderCetakSkriningPasien = async (req, res) => {
    const { id_pasien, id_kegiatan } = req.params;
    try {
        // 1. Ambil detail pasien
        const pasienRes = await pool.query(`
            SELECT p.*, j.nama_jorong, n.nama_nagari
            FROM pasien p
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            WHERE p.id_pasien = $1
        `, [id_pasien]);

        if (pasienRes.rows.length === 0) {
            return res.status(404).send("Pasien tidak ditemukan.");
        }

        // 2. Ambil detail kegiatan
        const kegiatanRes = await pool.query(`
            SELECT k.*, 
                   (
                       SELECT nama_user FROM "user" 
                       WHERE id_user = (SELECT id_validator FROM skrining WHERE id_kegiatan = k.id_kegiatan AND id_validator IS NOT NULL LIMIT 1)
                   ) AS nama_validator,
                   (SELECT nama_user FROM "user" WHERE role = 'pj_ptm' LIMIT 1) AS nama_pj
            FROM kegiatan k
            WHERE k.id_kegiatan = $1
        `, [id_kegiatan]);

        if (kegiatanRes.rows.length === 0) {
            return res.status(404).send("Kegiatan tidak ditemukan.");
        }

        // 3. Ambil data skrining
        const skriningRes = await pool.query(`
            SELECT s.*, jp.nama_ptm,
                   hp.status_tekanan   AS ht_status_tekanan,
                   dmt.gula_darah      AS dm_gula_darah,
                   dmt.jenis_pemeriksaan AS dm_jenis_pemeriksaan,
                   dmt.kategori_hasil  AS dm_kategori_hasil,
                   obt.berat_badan     AS ob_berat_badan,
                   obt.tinggi_badan    AS ob_tinggi_badan,
                   obt.imt             AS ob_imt,
                   obt.lingkar_perut   AS ob_lingkar_perut,
                   obt.kategori_obesitas AS ob_kategori_obesitas,
                   ppt.jumlah_batang_rokok_per_hari AS pp_rokok_per_hari,
                   ppt.lama_tahun_merokok AS pp_lama_merokok,
                   ppt.sesak_napas     AS pp_sesak_napas,
                   ppt.batuk_berdahak_kronis AS pp_batuk_kronis,
                   ppt.skor_total      AS pp_skor_total,
                   ppt.kategori_risiko AS pp_kategori_risiko,
                   ppt.rujukan_spirometri AS pp_rujukan_spirometri,
                   git.hasil_pemeriksaan_mata AS gi_mata,
                   git.hasil_pemeriksaan_telinga AS gi_telinga,
                   git.keterangan      AS gi_keterangan,
                   kjt.skor_total      AS kj_skor_total,
                   kjt.kategori_hasil  AS kj_kategori_hasil,
                   kjt.indikasi_risiko_bunuh_diri AS kj_risiko_bunuh_diri
            FROM skrining s
            LEFT JOIN jenis_ptm jp ON s.id_jenis_ptm = jp.id_jenis_ptm
            LEFT JOIN skrining_hipertensi hp   ON hp.id_skrining  = s.id_skrining
            LEFT JOIN skrining_dm dmt          ON dmt.id_skrining = s.id_skrining
            LEFT JOIN skrining_obesitas obt    ON obt.id_skrining = s.id_skrining
            LEFT JOIN skrining_ppok ppt        ON ppt.id_skrining = s.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
            WHERE s.id_pasien = $1 AND s.id_kegiatan = $2
        `, [id_pasien, id_kegiatan]);

        res.render('kader/cetak_skrining_pasien', {
            pasien: pasienRes.rows[0],
            kegiatan: kegiatanRes.rows[0],
            skriningList: skriningRes.rows,
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader',
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat pratinjau cetak skrining.");
    }
};

// 7. Cetak Semua Riwayat Skrining Pasien
exports.renderCetakSemuaSkrining = async (req, res) => {
    const { id_pasien } = req.params;
    try {
        // 1. Ambil detail pasien
        const pasienRes = await pool.query(`
            SELECT p.*, j.nama_jorong, n.nama_nagari
            FROM pasien p
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            WHERE p.id_pasien = $1
        `, [id_pasien]);

        if (pasienRes.rows.length === 0) {
            return res.status(404).send("Pasien tidak ditemukan.");
        }

        const pasien = pasienRes.rows[0];

        // Hitung Usia
        const currentYear = new Date().getFullYear();
        pasien.usia = pasien.tahun_lahir ? currentYear - pasien.tahun_lahir : pasien.usia;

        // 2. Ambil semua riwayat skrining pasien
        const queryStr = `
            SELECT s.*, k.tanggal_kegiatan, k.lokasi, jp.nama_ptm,
                   u.nama_user AS nama_kader,
                   (SELECT nama_user FROM "user" WHERE id_user = s.id_validator) AS nama_validator,
                   hp.status_tekanan   AS ht_status_tekanan,
                   dmt.gula_darah      AS dm_gula_darah,
                   dmt.jenis_pemeriksaan AS dm_jenis_pemeriksaan,
                   dmt.kategori_hasil  AS dm_kategori_hasil,
                   obt.berat_badan     AS ob_berat_badan,
                   obt.tinggi_badan    AS ob_tinggi_badan,
                   obt.imt             AS ob_imt,
                   obt.lingkar_perut   AS ob_lingkar_perut,
                   obt.kategori_obesitas AS ob_kategori_obesitas,
                   ppt.jumlah_batang_rokok_per_hari AS pp_rokok_per_hari,
                   ppt.lama_tahun_merokok AS pp_lama_merokok,
                   ppt.sesak_napas     AS pp_sesak_napas,
                   ppt.batuk_berdahak_kronis AS pp_batuk_kronis,
                   ppt.skor_total      AS pp_skor_total,
                   ppt.kategori_risiko AS pp_kategori_risiko,
                   ppt.rujukan_spirometri AS pp_rujukan_spirometri,
                   git.hasil_pemeriksaan_mata AS gi_mata,
                   git.hasil_pemeriksaan_telinga AS gi_telinga,
                   git.keterangan      AS gi_keterangan,
                   kjt.skor_total      AS kj_skor_total,
                   kjt.kategori_hasil  AS kj_kategori_hasil,
                   kjt.indikasi_risiko_bunuh_diri AS kj_risiko_bunuh_diri
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            LEFT JOIN jenis_ptm jp ON s.id_jenis_ptm = jp.id_jenis_ptm
            LEFT JOIN "user" u ON s.id_kader = u.id_user
            LEFT JOIN skrining_hipertensi hp   ON hp.id_skrining  = s.id_skrining
            LEFT JOIN skrining_dm dmt          ON dmt.id_skrining = s.id_skrining
            LEFT JOIN skrining_obesitas obt    ON obt.id_skrining = s.id_skrining
            LEFT JOIN skrining_ppok ppt        ON ppt.id_skrining = s.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
            WHERE s.id_pasien = $1
            ORDER BY k.tanggal_kegiatan DESC, s.id_skrining DESC
        `;
        const skriningRes = await pool.query(queryStr, [id_pasien]);

        // Grouping by id_kegiatan
        const grouped = {};
        skriningRes.rows.forEach(row => {
            const key = row.id_kegiatan;
            if (!grouped[key]) {
                grouped[key] = {
                    id_kegiatan: row.id_kegiatan,
                    tanggal_kegiatan: row.tanggal_kegiatan,
                    lokasi: row.lokasi,
                    nama_kader: row.nama_kader,
                    nama_validator: row.nama_validator,
                    pemeriksaan: []
                };
            }
            grouped[key].pemeriksaan.push(row);
        });

        const kunjunganList = Object.values(grouped).sort((a, b) => new Date(b.tanggal_kegiatan) - new Date(a.tanggal_kegiatan));

        res.render('kader/cetak_riwayat_semua', {
            pasien,
            kunjunganList,
            currentUser: req.session.user || null,
            tanggalCetak: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat pratinjau cetak riwayat.");
    }
};