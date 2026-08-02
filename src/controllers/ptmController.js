const pool = require('../config/db'); 

/**
 * 1. Menampilkan Halaman Daftar Pasien (Kelola Pasien)
 *    Mendukung search, filter nagari/jorong, & pagination server-side
 *    (sama seperti Daftar Pasien di role Kader).
 */
exports.renderKelolaPasien = async (req, res) => {
    try {
        const search       = (req.query.search || '').trim();
        const nagariFilter = (req.query.nagari || '').trim(); // id_nagari
        const jorongFilter = (req.query.jorong || '').trim(); // id_jorong
        const page          = Math.max(1, parseInt(req.query.page) || 1);
        const limit          = 20; // tampilkan 20 data per halaman
        const offset          = (page - 1) * limit;

        const conditions  = [];
        const queryParams = [];

        if (search !== '') {
            queryParams.push(`%${search}%`);
            conditions.push(`(p.nama_pasien ILIKE $${queryParams.length} OR p.nik ILIKE $${queryParams.length})`);
        }
        if (nagariFilter !== '') {
            queryParams.push(nagariFilter);
            conditions.push(`n.id_nagari = $${queryParams.length}`);
        }
        if (jorongFilter !== '') {
            queryParams.push(jorongFilter);
            conditions.push(`p.id_jorong = $${queryParams.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countQuery = `
            SELECT COUNT(*) 
            FROM pasien p 
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const totalData   = parseInt(countResult.rows[0].count);
        const totalPages  = Math.max(1, Math.ceil(totalData / limit));

        const limitIdx   = queryParams.length + 1;
        const offsetIdx  = queryParams.length + 2;
        const dataParams = [...queryParams, limit, offset];

        const dataQuery = `
            SELECT p.*, j.nama_jorong, n.nama_nagari, n.id_nagari
            FROM pasien p 
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            ${whereClause}
            ORDER BY p.nama_pasien ASC
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;
        const result = await pool.query(dataQuery, dataParams);

        const nagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');
        const jorong = await pool.query(`
            SELECT j.*, n.nama_nagari 
            FROM jorong j JOIN nagari n ON j.id_nagari = n.id_nagari 
            ORDER BY j.nama_jorong ASC
        `);

        res.render('ptm/kelolapasien', { 
            pasien: result.rows,
            nagari: nagari.rows,
            jorong: jorong.rows,
            active: 'pasien',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm',
            search,
            selectedNagari: nagariFilter,
            selectedJorong: jorongFilter,
            page,
            totalPages,
            totalData,
            limit,
            successMessage: req.session.successMessage || null,
            errorMessage:   req.session.errorMessage   || null,
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;
    } catch (err) {
        console.error("ERROR RENDER KELOLA PASIEN:", err);
        res.status(500).send("Gagal memuat daftar pasien.");
    }
};

/**
 * 2. Menampilkan Halaman Detail Pasien (read-only)
 *    Menampilkan biodata lengkap + riwayat skrining pasien.
 */
exports.renderDetailPasien = async (req, res) => {
    const { id } = req.params;
    try {
        const resPasien = await pool.query(`
            SELECT p.*, j.nama_jorong, n.nama_nagari
            FROM pasien p
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            WHERE p.id_pasien = $1
        `, [id]);

        if (resPasien.rows.length === 0) {
            return res.status(404).send("Data pasien tidak ditemukan.");
        }

        const resRiwayat = await pool.query(`
            SELECT s.*, k.tanggal_kegiatan, k.lokasi
            FROM skrining s
            LEFT JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.id_pasien = $1
            ORDER BY s.tanggal_skrining DESC
        `, [id]);

        res.render('ptm/detail_pasien', {
            pasien: resPasien.rows[0],
            riwayat: resRiwayat.rows,
            active: 'pasien',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm'
        });
    } catch (err) {
        console.error("ERROR RENDER DETAIL PASIEN:", err);
        res.status(500).send("Terjadi kesalahan saat mengambil data detail pasien.");
    }
};

/**
 * 3. Menampilkan Form Edit Pasien
 */
exports.renderEditPasien = async (req, res) => {
    const { id } = req.params; // Mengambil NIK/ID dari URL
    try {
        // Ambil data pasien yang mau diedit (sertakan id_nagari saat ini lewat join jorong)
        const resPasien = await pool.query(`
            SELECT p.*, j.id_nagari
            FROM pasien p
            JOIN jorong j ON p.id_jorong = j.id_jorong
            WHERE p.id_pasien = $1
        `, [id]);

        // Ambil juga daftar nagari & jorong untuk pilihan dropdown di form
        const resNagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');
        const resJorong = await pool.query('SELECT * FROM jorong ORDER BY nama_jorong ASC');

        if (resPasien.rows.length === 0) {
            return res.status(404).send("Data pasien tidak ditemukan.");
        }

        res.render('ptm/edit_pasien', { 
            pasien: resPasien.rows[0],
            nagari: resNagari.rows,
            jorong: resJorong.rows,
            active: 'pasien',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm'
        });
    } catch (err) {
        console.error("ERROR RENDER EDIT PASIEN:", err);
        res.status(500).send("Terjadi kesalahan saat mengambil data pasien.");
    }
};

/**
 * 4. Memproses Update Data Pasien
 */
exports.handleUpdatePasien = async (req, res) => {
    // Ambil semua data yang dikirim dari form
    const { id_pasien, nik, nama_pasien, usia, jenis_kelamin, id_jorong, alamat, no_hp, pekerjaan, agama } = req.body;

    try {
        // Kalkulasi ulang tahun lahir berdasarkan usia yang baru diinput
        const tahunSekarang = new Date().getFullYear();
        const tahun_lahir = tahunSekarang - parseInt(usia);

        const query = `
            UPDATE pasien 
            SET nik = $1, nama_pasien = $2, usia = $3, tahun_lahir = $4, 
                jenis_kelamin = $5, id_jorong = $6, alamat = $7, 
                no_hp = $8, pekerjaan = $9, agama = $10
            WHERE id_pasien = $11
        `;

        const values = [nik, nama_pasien, usia, tahun_lahir, jenis_kelamin, id_jorong, alamat, no_hp, pekerjaan, agama, id_pasien];

        await pool.query(query, values);
        
        // Setelah sukses, lempar kembali ke halaman daftar pasien
        res.redirect('/ptm/pasien');

    } catch (err) {
        console.error("ERROR UPDATE PASIEN:", err);
        res.status(500).send("Gagal memperbarui data pasien.");
    }
};


 //5. Memproses Hapus Data Pasien
exports.handleDeletePasien = async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Hapus semua riwayat skrining
        await pool.query('DELETE FROM skrining WHERE id_pasien = $1', [id]);

        // 2. Hapus data induknya (pasien)
        await pool.query('DELETE FROM pasien WHERE id_pasien = $1', [id]);

        req.session.successMessage = 'Data pasien beserta riwayatnya berhasil dihapus permanen!';
    } catch (err) {
        console.error("ERROR DELETE PASIEN:", err);
        req.session.errorMessage = 'Gagal menghapus! Pastikan tidak ada data lain yang terkait dengan pasien ini.';
    }
    res.redirect('/ptm/pasien');
};

/**
 * 6. Menampilkan Halaman Dashboard PTM
 */
exports.renderDashboardPTM = async (req, res) => {
    try {
        const tahunIni = new Date().getFullYear();
        const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';

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

        // ── Ambil target dari DB (SUM dari target nagari, fallback 2000 jika belum diset) ──
        const resTarget = await pool.query(
            'SELECT SUM(target_total) as target_total FROM target_tahunan WHERE tahun = $1 AND id_jenis_ptm = $2',
            [tahunIni, jenisPtmTerpilih]
        );
        const TARGET_TAHUNAN = resTarget.rows[0] && resTarget.rows[0].target_total
            ? parseInt(resTarget.rows[0].target_total)
            : 2000;

        // ── 1. Total Skrining Tahun Ini (Capaian) ──
        const qCapaian = `
            SELECT COUNT(DISTINCT s.id_pasien) as total_tercapai
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
              AND s.id_jenis_ptm = $2
        `;
        const resCapaian  = await pool.query(qCapaian, [tahunIni, jenisPtmTerpilih]);
        const totalTercapai = parseInt(resCapaian.rows[0].total_tercapai) || 0;
        const sisaTarget    = Math.max(0, TARGET_TAHUNAN - totalTercapai);
        const persenTarget  = TARGET_TAHUNAN > 0
            ? Math.round((totalTercapai / TARGET_TAHUNAN) * 100)
            : 0;

        // ── 2. Metrik Abnormal & Normal/Terkendali (Tahun Ini) ──
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

        const qMetrik = `
            SELECT 
                COUNT(DISTINCT CASE WHEN ${filterAbnormal} THEN s.id_pasien END) as abnormal_cases,
                COUNT(DISTINCT CASE WHEN ${filterNormal} THEN s.id_pasien END) as normal_cases
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
              AND s.id_jenis_ptm = $2
        `;
        const resMetrik       = await pool.query(qMetrik, [tahunIni, jenisPtmTerpilih]);
        const totalHipertensi = parseInt(resMetrik.rows[0].abnormal_cases)  || 0;
        const totalTerkendali = parseInt(resMetrik.rows[0].normal_cases)  || 0;
        const persenHipertensi = totalTercapai > 0
            ? ((totalHipertensi / totalTercapai) * 100).toFixed(1) : 0;
        const persenTerkendali = totalTercapai > 0
            ? ((totalTerkendali / totalTercapai) * 100).toFixed(1) : 0;

        // ── 3. Capaian per Nagari ──
        const qNagari = `
            WITH target_per_nagari AS (
                SELECT id_nagari, target_total 
                FROM target_tahunan 
                WHERE tahun = $1 AND id_jenis_ptm = $2
            ),
            capaian_per_nagari AS (
                SELECT n.id_nagari, COUNT(DISTINCT s.id_pasien) AS capaian
                FROM skrining s
                JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                JOIN pasien   p ON s.id_pasien   = p.id_pasien
                JOIN jorong   j ON p.id_jorong   = j.id_jorong
                JOIN nagari   n ON j.id_nagari   = n.id_nagari
                WHERE s.status_validasi = 'terverifikasi'
                  AND EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
                  AND s.id_jenis_ptm = $2
                GROUP BY n.id_nagari
            )
            SELECT
                n.nama_nagari,
                COALESCE(c.capaian, 0)       AS capaian,
                COALESCE(tn.target_total, 0) AS target_total
            FROM nagari n
            LEFT JOIN capaian_per_nagari c ON n.id_nagari = c.id_nagari
            LEFT JOIN target_per_nagari  tn ON n.id_nagari = tn.id_nagari
            WHERE n.is_active = true
            ORDER BY capaian DESC
        `;
        const resNagari = await pool.query(qNagari, [tahunIni, jenisPtmTerpilih]);

        const dataNagari = resNagari.rows.map(row => {
            const capaian = parseInt(row.capaian) || 0;
            const target_total = parseInt(row.target_total) || 0;
            const target = target_total > 0 ? target_total : Math.max(1, Math.round(TARGET_TAHUNAN / 7));
            return {
                nama_nagari: row.nama_nagari,
                capaian,
                target,
                persentase: target > 0 ? Math.round((capaian / target) * 100) : 0,
            };
        });

        // ── 4. Sebaran Pemeriksaan PTM (Tahun Ini) ──
        const queryPtmStats = `
            SELECT 
                COUNT(CASE WHEN s.id_jenis_ptm = 'hipertensi' THEN 1 END) AS hipertensi,
                COUNT(CASE WHEN s.id_jenis_ptm = 'dm' THEN 1 END) AS dm,
                COUNT(CASE WHEN s.id_jenis_ptm = 'obesitas' THEN 1 END) AS obesitas,
                COUNT(CASE WHEN s.id_jenis_ptm = 'ppok' THEN 1 END) AS ppok,
                COUNT(CASE WHEN s.id_jenis_ptm = 'gangguan_indra' THEN 1 END) AS gangguan_indra,
                COUNT(CASE WHEN s.id_jenis_ptm = 'kesehatan_jiwa' THEN 1 END) AS kesehatan_jiwa,
                COUNT(s.id_skrining) AS total
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
              AND EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
        `;
        const resPtmStats = await pool.query(queryPtmStats, [tahunIni]);

        res.render('ptm/dashboardptm', {
            active: 'dashboard',
            currentUser:      req.session.user || null,
            role:             req.session.user ? req.session.user.role : 'pj_ptm',
            tahunIni,
            TARGET_TAHUNAN,
            totalTercapai,
            sisaTarget,
            persenTarget,
            totalHipertensi,
            persenHipertensi,
            persenTerkendali,
            dataNagari,
            jenisPtmList:     resJenisPtm.rows,
            jenisPtmTerpilih,
            namaPtmTerpilih,
            ptmStats: resPtmStats.rows[0],
            successMessage: req.session.successMessage || null,
            errorMessage:   req.session.errorMessage   || null,
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('ERROR RENDER DASHBOARD PTM:', err);
        res.status(500).send('Gagal memuat dashboard PTM.');
    }
};
