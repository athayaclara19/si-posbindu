const pool = require('../config/db');

// Untuk KADER: hanya lihat jadwal
exports.renderJadwalKader = async (req, res) => {
    try {
        const query = `
            SELECT k.*, j.nama_jorong, p.periode_bulan, p.periode_tahun
            FROM kegiatan k
            JOIN jorong j  ON k.id_jorong = j.id_jorong
            JOIN periode p ON k.id_periode = p.periode_id
            ORDER BY k.tanggal_kegiatan ASC
        `;
        const result = await pool.query(query);
        res.render('kader/jadwal', { jadwal: result.rows, active: 'jadwal' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat jadwal: " + err.message);
    }
};

// Render halaman jadwal PTM
exports.renderJadwalPTM = async (req, res) => {
    try {
        // Ambil semua jadwal kegiatan
        const queryKegiatan = `
            SELECT k.*, j.nama_jorong, p.periode_bulan, p.periode_tahun
            FROM kegiatan k
            JOIN jorong j ON k.id_jorong = j.id_jorong
            JOIN periode p ON k.id_periode = p.periode_id
            ORDER BY k.tanggal_kegiatan DESC
        `;
        const kegiatan = await pool.query(queryKegiatan);

        // Ambil data jorong untuk opsi form tambah
        const jorong = await pool.query('SELECT * FROM jorong ORDER BY nama_jorong ASC');

        res.render('ptm/jadwalptm', { 
            jadwal: kegiatan.rows, 
            jorong: jorong.rows, 
            active: 'jadwal' // Untuk penanda menu sidebar
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat jadwal PTM.");
    }
};

/// Proses tambah jadwal kegiatan baru
exports.handleTambahJadwal = async (req, res) => {
    const { tanggal_kegiatan, lokasi, id_jorong } = req.body;
    try {
        // 1. Ekstrak bulan dan tahun secara otomatis dari tanggal yang diinput
        const dateObj = new Date(tanggal_kegiatan);
        const bulan = dateObj.getMonth() + 1; // Karena di JavaScript, bulan dimulai dari 0
        const tahun = dateObj.getFullYear();

        // 2. Cek apakah periode bulan & tahun ini sudah ada di database
        let periodeResult = await pool.query(
            'SELECT periode_id FROM periode WHERE periode_bulan = $1 AND periode_tahun = $2',
            [bulan, tahun]
        );

        let id_periode;
        if (periodeResult.rows.length === 0) {
            // Jika bulan/tahun ini belum ada, buat baru di tabel periode
            const newPeriode = await pool.query(
                'INSERT INTO periode (periode_bulan, periode_tahun) VALUES ($1, $2) RETURNING periode_id',
                [bulan, tahun]
            );
            id_periode = newPeriode.rows[0].periode_id;
        } else {
            // Jika sudah ada, langsung gunakan ID-nya
            id_periode = periodeResult.rows[0].periode_id;
        }

        // 3. Simpan jadwal ke tabel kegiatan dengan id_periode yang tepat
        await pool.query(
            'INSERT INTO kegiatan (tanggal_kegiatan, lokasi, id_jorong, id_periode) VALUES ($1, $2, $3, $4)',
            [tanggal_kegiatan, lokasi, id_jorong, id_periode]
        );

        // Arahkan kembali ke halaman jadwal
        res.redirect('/ptm/jadwal');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menambah jadwal.");
    }
};