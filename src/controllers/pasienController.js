const pool = require('../config/db');

// 1. Tampilkan Daftar Pasien (dengan server-side search & pagination)
exports.renderDaftarPasien = async (req, res) => {
    try {
        // Ambil parameter dari query string
        const search   = (req.query.search || '').trim();
        const page     = Math.max(1, parseInt(req.query.page) || 1);
        const limit    = 20; // tampilkan 20 data per halaman
        const offset   = (page - 1) * limit;

        // Bangun kondisi WHERE berdasarkan search
        let whereClause = '';
        let queryParams = [];

        if (search !== '') {
            whereClause = `WHERE p.nama_pasien ILIKE $1 OR p.nik ILIKE $1`;
            queryParams = [`%${search}%`];
        }

        // Hitung total data (untuk pagination)
        const countQuery = `SELECT COUNT(*) FROM pasien p JOIN jorong j ON p.id_jorong = j.id_jorong ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalData   = parseInt(countResult.rows[0].count);
        const totalPages  = Math.ceil(totalData / limit);

        // Query data dengan LIMIT dan OFFSET
        const dataParams  = search !== '' ? [`%${search}%`, limit, offset] : [limit, offset];
        const limitParam  = search !== '' ? '$2' : '$1';
        const offsetParam = search !== '' ? '$3' : '$2';

        const dataQuery = `
            SELECT p.*, j.nama_jorong 
            FROM pasien p 
            JOIN jorong j ON p.id_jorong = j.id_jorong 
            ${whereClause}
            ORDER BY p.id_pasien DESC 
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `;
        const result = await pool.query(dataQuery, dataParams);

        // Ambil data nagari dan jorong untuk filter
        const nagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');
        const jorong = await pool.query(`
            SELECT j.*, n.nama_nagari 
            FROM jorong j 
            JOIN nagari n ON j.id_nagari = n.id_nagari 
            ORDER BY j.nama_jorong ASC
        `);

        res.render('kader/pasien', { 
            daftarPasien: result.rows,
            nagari: nagari.rows,
            jorong: jorong.rows,
            active: 'pasien',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader',
            // Data pagination & search untuk dipakai di view
            search,
            page,
            totalPages,
            totalData,
            limit,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat daftar pasien");
    }
};

// 2. Tampilkan Form Tambah Pasien
exports.renderTambahPasien = async (req, res) => {
    try {
        const nagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');
        const jorong = await pool.query('SELECT * FROM jorong ORDER BY nama_jorong ASC');
        
        res.render('kader/tambah_pasien', { 
            nagari: nagari.rows,
            jorong: jorong.rows,
            active: 'pasien',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat form tambah pasien");
    }
};

// 3. Proses Simpan Pasien Baru
exports.handleTambahPasien = async (req, res) => {
    try {
        const { id_jorong, nik, nama_pasien, usia, jenis_kelamin, alamat, no_hp, pekerjaan, agama } = req.body;
        const id_pasien    = nik; 
        const tahunSekarang = new Date().getFullYear();
        const tahun_lahir  = tahunSekarang - parseInt(usia);

        const query = `
            INSERT INTO pasien (id_pasien, id_jorong, nik, nama_pasien, usia, tahun_lahir, jenis_kelamin, alamat, no_hp, pekerjaan, agama) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `;
        const values = [id_pasien, id_jorong, nik, nama_pasien, usia, tahun_lahir, jenis_kelamin, alamat, no_hp, pekerjaan, agama];
        await pool.query(query, values);
        res.redirect('/pasien');

    } catch (err) {
        console.error("ERROR SAAT SIMPAN PASIEN:", err); 
        res.status(500).send("<script>alert('Gagal menambah pasien. Cek terminal untuk detailnya.'); window.history.back();</script>");
    }
};
