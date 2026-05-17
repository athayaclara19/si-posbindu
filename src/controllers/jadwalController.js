const pool = require('../config/db');

// ============================================================
// KADER: Hanya lihat jadwal (tidak bisa edit/hapus)
// ============================================================
exports.renderJadwalKader = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT k.*, j.nama_jorong, p.periode_bulan, p.periode_tahun
            FROM kegiatan k
            JOIN jorong j  ON k.id_jorong  = j.id_jorong
            JOIN periode p ON k.id_periode = p.periode_id
            ORDER BY k.tanggal_kegiatan ASC
        `);
        res.render('kader/jadwal', {
            jadwal: result.rows,
            active: 'jadwal',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kader'
        });
    } catch (err) {
        console.error('ERROR renderJadwalKader:', err);
        res.status(500).send('Gagal memuat jadwal: ' + err.message);
    }
};

// ============================================================
// PTM: Render halaman kelola jadwal
// ============================================================
exports.renderJadwalPTM = async (req, res) => {
    try {
        const kegiatan = await pool.query(`
            SELECT k.*, j.nama_jorong, n.nama_nagari,
                   p.periode_bulan, p.periode_tahun,
                   (SELECT COUNT(*) FROM skrining s WHERE s.id_kegiatan = k.id_kegiatan) AS jumlah_skrining
            FROM kegiatan k
            JOIN jorong  j ON k.id_jorong  = j.id_jorong
            JOIN nagari  n ON j.id_nagari  = n.id_nagari
            JOIN periode p ON k.id_periode = p.periode_id
            ORDER BY k.tanggal_kegiatan DESC
        `);
        const jorong = await pool.query('SELECT * FROM jorong ORDER BY nama_jorong ASC');
        const nagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');

        res.render('ptm/jadwalptm', {
            jadwal: kegiatan.rows,
            jorong: jorong.rows,
            nagari: nagari.rows,
            active: 'jadwal',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm'
        });
    } catch (err) {
        console.error('ERROR renderJadwalPTM:', err);
        res.status(500).send('Gagal memuat jadwal PTM.');
    }
};

// ============================================================
// PTM: Tambah jadwal baru
// ============================================================
exports.handleTambahJadwal = async (req, res) => {
    const { tanggal_kegiatan, lokasi, id_jorong } = req.body;
    try {
        // VALIDASI BACKEND 1: Pastikan semua field terisi
        if (!tanggal_kegiatan || !lokasi || !id_jorong) {
            return res.redirect('/ptm/jadwal?error=data_tidak_lengkap');
        }

        const dateObj = new Date(tanggal_kegiatan);

        // VALIDASI BACKEND 2: Cegah tanggal masa lalu
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dateObj < today) {
            return res.redirect('/ptm/jadwal?error=tanggal_masa_lalu');
        }

        // VALIDASI BACKEND 3: Cegah hari Minggu (getDay() === 0)
        if (dateObj.getDay() === 0) {
            return res.redirect('/ptm/jadwal?error=hari_minggu');
        }

        const bulan = dateObj.getMonth() + 1;
        const tahun = dateObj.getFullYear();

        // Cari atau buat periode
        let periodeResult = await pool.query(
            'SELECT periode_id FROM periode WHERE periode_bulan = $1 AND periode_tahun = $2',
            [bulan, tahun]
        );
        let id_periode;
        if (periodeResult.rows.length === 0) {
            const newPeriode = await pool.query(
                'INSERT INTO periode (periode_bulan, periode_tahun) VALUES ($1, $2) RETURNING periode_id',
                [bulan, tahun]
            );
            id_periode = newPeriode.rows[0].periode_id;
        } else {
            id_periode = periodeResult.rows[0].periode_id;
        }

        await pool.query(
            'INSERT INTO kegiatan (tanggal_kegiatan, lokasi, id_jorong, id_periode) VALUES ($1, $2, $3, $4)',
            [tanggal_kegiatan, lokasi, id_jorong, id_periode]
        );

        res.redirect('/ptm/jadwal?success=jadwal_ditambah');
    } catch (err) {
        console.error('ERROR handleTambahJadwal:', err);
        res.redirect('/ptm/jadwal?error=gagal_tambah');
    }
};

// ============================================================
// PTM: Edit jadwal — render form edit
// ============================================================
exports.renderEditJadwal = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT k.*, j.nama_jorong, j.id_nagari, n.nama_nagari
            FROM kegiatan k
            JOIN jorong j ON k.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            WHERE k.id_kegiatan = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.redirect('/ptm/jadwal?error=tidak_ditemukan');
        }

        // Cek apakah sudah ada skrining → kalau sudah ada, tidak bisa edit tanggal
        const skriningCheck = await pool.query(
            'SELECT COUNT(*)::int AS total FROM skrining WHERE id_kegiatan = $1',
            [id]
        );
        const sudahAdaSkrining = skriningCheck.rows[0].total > 0;

        const jorong = await pool.query('SELECT * FROM jorong ORDER BY nama_jorong ASC');
        const nagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');

        res.render('ptm/edit_jadwal', {
            kegiatan: result.rows[0],
            jorong: jorong.rows,
            nagari: nagari.rows,
            sudahAdaSkrining,
            active: 'jadwal',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm'
        });
    } catch (err) {
        console.error('ERROR renderEditJadwal:', err);
        res.redirect('/ptm/jadwal?error=gagal_muat');
    }
};

// PTM: Edit jadwal — simpan perubahan
exports.handleEditJadwal = async (req, res) => {
    const { id } = req.params;
    const { tanggal_kegiatan, lokasi, id_jorong } = req.body;
    try {
        // Cek apakah ada skrining → jika ada, hanya boleh edit lokasi & jorong
        const skriningCheck = await pool.query(
            'SELECT COUNT(*)::int AS total FROM skrining WHERE id_kegiatan = $1',
            [id]
        );
        const sudahAdaSkrining = skriningCheck.rows[0].total > 0;

        if (sudahAdaSkrining) {
            // Kalau sudah ada skrining, hanya boleh edit lokasi dan jorong saja
            await pool.query(
                'UPDATE kegiatan SET lokasi = $1, id_jorong = $2 WHERE id_kegiatan = $3',
                [lokasi, id_jorong, id]
            );
        } else {
            // Kalau belum ada skrining, boleh edit semua termasuk tanggal
            const dateObj = new Date(tanggal_kegiatan);

            // Validasi hari minggu
            if (dateObj.getDay() === 0) {
                return res.redirect(`/ptm/jadwal/edit/${id}?error=hari_minggu`);
            }

            const bulan = dateObj.getMonth() + 1;
            const tahun = dateObj.getFullYear();

            let periodeResult = await pool.query(
                'SELECT periode_id FROM periode WHERE periode_bulan = $1 AND periode_tahun = $2',
                [bulan, tahun]
            );
            let id_periode;
            if (periodeResult.rows.length === 0) {
                const newPeriode = await pool.query(
                    'INSERT INTO periode (periode_bulan, periode_tahun) VALUES ($1, $2) RETURNING periode_id',
                    [bulan, tahun]
                );
                id_periode = newPeriode.rows[0].periode_id;
            } else {
                id_periode = periodeResult.rows[0].periode_id;
            }

            await pool.query(
                'UPDATE kegiatan SET tanggal_kegiatan = $1, lokasi = $2, id_jorong = $3, id_periode = $4 WHERE id_kegiatan = $5',
                [tanggal_kegiatan, lokasi, id_jorong, id_periode, id]
            );
        }

        res.redirect('/ptm/jadwal?success=jadwal_diperbarui');
    } catch (err) {
        console.error('ERROR handleEditJadwal:', err);
        res.redirect('/ptm/jadwal?error=gagal_edit');
    }
};

// ============================================================
// PTM: Hapus jadwal
// ATURAN: Hanya bisa dihapus kalau BELUM ada skrining yang terinput
// ============================================================
exports.handleHapusJadwal = async (req, res) => {
    const { id } = req.params;
    try {
        // CEK dulu apakah ada skrining yang sudah terinput di jadwal ini
        const skriningCheck = await pool.query(
            'SELECT COUNT(*)::int AS total FROM skrining WHERE id_kegiatan = $1',
            [id]
        );
        const jumlahSkrining = skriningCheck.rows[0].total;

        if (jumlahSkrining > 0) {
            // Tidak boleh hapus! Ada data skrining yang terhubung
            return res.redirect('/ptm/jadwal?error=ada_skrining');
        }

        // Aman untuk dihapus
        await pool.query('DELETE FROM kegiatan WHERE id_kegiatan = $1', [id]);
        res.redirect('/ptm/jadwal?success=jadwal_dihapus');
    } catch (err) {
        console.error('ERROR handleHapusJadwal:', err);
        res.redirect('/ptm/jadwal?error=gagal_hapus');
    }
};

// ============================================================
// PTM: Detail jadwal (API — dipanggil oleh modal di frontend)
// ============================================================
exports.getDetailJadwal = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT k.*, j.nama_jorong, n.nama_nagari,
                   p.periode_bulan, p.periode_tahun,
                   COUNT(s.id_skrining)::int AS jumlah_skrining
            FROM kegiatan k
            JOIN jorong  j ON k.id_jorong  = j.id_jorong
            JOIN nagari  n ON j.id_nagari  = n.id_nagari
            JOIN periode p ON k.id_periode = p.periode_id
            LEFT JOIN skrining s ON s.id_kegiatan = k.id_kegiatan
            WHERE k.id_kegiatan = $1
            GROUP BY k.id_kegiatan, j.nama_jorong, n.nama_nagari, p.periode_bulan, p.periode_tahun
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('ERROR getDetailJadwal:', err);
        res.status(500).json({ error: 'Gagal mengambil detail jadwal' });
    }
};
