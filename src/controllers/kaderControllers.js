const pool = require('../config/db');

// 1. Render Form Input Skrining
exports.renderInputSkrining = async (req, res) => {
    try {
        const pasien   = await pool.query('SELECT id_pasien, nama_pasien, nik FROM pasien ORDER BY nama_pasien ASC');
        const kegiatan = await pool.query('SELECT id_kegiatan, lokasi, tanggal_kegiatan FROM kegiatan ORDER BY tanggal_kegiatan DESC');
        res.render('kader/skrining', {
            pasien: pasien.rows, kegiatan: kegiatan.rows,
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

// 2. Proses Simpan Skrining (POST)
exports.handleInputSkrining = async (req, res) => {
    const {
        id_pasien, id_kegiatan, sistole, diastole,
        berat_badan, tinggi_badan, gula_darah, kolesterol,
        lingkar_perut, frekuensi_nadi, merokok, pola_makan,
        aktivitas_fisik, riwayat_keluarga, tingkat_stres,
        terapi_obat, kepatuhan_obat, edukasi, status_rujukan
    } = req.body;

    const id_kader = req.session.user.id_user; // PERBAIKAN: gunakan id_user

    try {
        const query = `
            INSERT INTO skrining 
            (id_pasien, id_kader, id_kegiatan, sistole, diastole, 
            berat_badan, tinggi_badan, gula_darah, kolesterol, 
            lingkar_perut, frekuensi_nadi, merokok, pola_makan, 
            aktivitas_fisik, riwayat_keluarga, tingkat_stres, 
            terapi_obat, kepatuhan_obat, edukasi, status_rujukan, 
            tanggal_skrining, status_validasi)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
            $14,$15,$16,$17,$18,$19,$20, CURRENT_DATE, 'menunggu')
        `;
        const values = [
            id_pasien, id_kader, id_kegiatan,
            parseInt(sistole), parseInt(diastole),
            berat_badan||null, tinggi_badan||null, gula_darah||null,
            kolesterol||null, lingkar_perut||null, frekuensi_nadi||null,
            merokok==='true'||merokok===true||merokok==='on',
            pola_makan||null, aktivitas_fisik||null,
            riwayat_keluarga==='true'||riwayat_keluarga==='on',
            tingkat_stres||null,
            terapi_obat==='true'||terapi_obat==='on',
            kepatuhan_obat||null, edukasi||null, status_rujukan||'tidak'
        ];
        await pool.query(query, values);
        res.redirect('/riwayat');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menyimpan data skrining: " + err.message);
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
            role: req.session.user ? req.session.user.role : 'kader'
        });
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

        const whereClause = 'WHERE ' + conditions.join(' AND ');

        // Hitung total untuk pagination
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM skrining s
             JOIN pasien p ON s.id_pasien = p.id_pasien
             ${whereClause}`, params);
        const totalData  = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalData / limit);

        // Ambil data dengan LIMIT & OFFSET
        const dataParams = [...params, limit, offset];
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, k.tanggal_kegiatan, j.nama_jorong
            FROM skrining s
            JOIN pasien   p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong   j ON p.id_jorong   = j.id_jorong
            ${whereClause}
            ORDER BY k.tanggal_kegiatan DESC
            LIMIT $${pi} OFFSET $${pi + 1}
        `;
        const result = await pool.query(query, dataParams);

        res.render('kader/riwayat', {
            riwayat: result.rows,
            active: 'riwayat',
            notifikasi: [],
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader',
            search,
            statusQ,
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
            SELECT s.*, p.nama_pasien, p.nik 
            FROM skrining s JOIN pasien p ON s.id_pasien = p.id_pasien
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
    const { sistole, diastole, berat_badan, tinggi_badan, gula_darah, kolesterol } = req.body;
    try {
        const query = `
            UPDATE skrining
            SET sistole=$1, diastole=$2, berat_badan=$3, tinggi_badan=$4,
                gula_darah=$5, kolesterol=$6, status_validasi='menunggu',
                tanggal_validasi=NULL
            WHERE id_skrining=$7
        `;
        await pool.query(query, [
            parseInt(sistole), parseInt(diastole),
            berat_badan||null, tinggi_badan||null,
            gula_darah||null, kolesterol||null,
            id_skrining
        ]);
        res.redirect('/riwayat');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menyimpan perubahan: " + err.message);
    }
};