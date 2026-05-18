const pool = require('../config/db');

const NAMA_BULAN = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

// ─────────────────────────────────────────────────────────────
// DASHBOARD KEPALA PUSKESMAS
// ─────────────────────────────────────────────────────────────
exports.renderDashboardKepala = async (req, res) => {
    try {
        // 1. Statistik kartu — pakai status 'disetujui' (sesuai DB)
        const statsRes = await pool.query(`
            SELECT
                COUNT(CASE WHEN status = 'dikirim'   THEN 1 END)::int AS menunggu,
                COUNT(CASE WHEN status = 'disetujui' THEN 1 END)::int AS disetujui,
                COUNT(CASE WHEN status = 'ditolak'   THEN 1 END)::int AS ditolak,
                COUNT(*)::int AS total
            FROM laporan
            WHERE status != 'draft'
        `);
        const stats = statsRes.rows[0] || { menunggu: 0, disetujui: 0, ditolak: 0, total: 0 };

        // 2. Persentase pasien terkendali
        const terkendaliRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien)::int AS total_pasien,
                COUNT(DISTINCT CASE WHEN s.sistole < 140 AND s.diastole < 90
                      THEN s.id_pasien END)::int AS terkendali
            FROM skrining s
            WHERE s.status_validasi = 'terverifikasi'
        `);
        const totalPasien      = terkendaliRes.rows[0]?.total_pasien || 0;
        const jumlahTerkendali = terkendaliRes.rows[0]?.terkendali  || 0;
        const persenTerkendali = totalPasien > 0
            ? ((jumlahTerkendali / totalPasien) * 100).toFixed(1) : '0.0';

        // 3. Semua laporan menunggu (bukan hanya 1)
        const menungguRes = await pool.query(`
            SELECT l.id_laporan, l.status, l.dikirim_pada,
                   l.total_pasien, l.total_skrining,
                   per.periode_bulan, per.periode_tahun,
                   u.nama_user AS nama_pj
            FROM laporan l
            JOIN periode per ON l.id_periode = per.periode_id
            JOIN "user"  u   ON l.id_pj      = u.id_user
            WHERE l.status = 'dikirim'
            ORDER BY l.dikirim_pada ASC
        `);

        // 4. Riwayat 10 laporan terakhir (disetujui / ditolak)
        const riwayatRes = await pool.query(`
            SELECT l.id_laporan, l.status, l.dikirim_pada,
                   per.periode_bulan, per.periode_tahun,
                   u.nama_user AS nama_pj
            FROM laporan l
            JOIN periode per ON l.id_periode = per.periode_id
            JOIN "user"  u   ON l.id_pj      = u.id_user
            WHERE l.status IN ('disetujui', 'ditolak')
            ORDER BY l.dikirim_pada DESC
            LIMIT 10
        `);

        const fmt = (row) => ({
            ...row,
            nama_bulan: NAMA_BULAN[(parseInt(row.periode_bulan) - 1)] || '-'
        });

        res.render('kepala/dashboardkepala', {
            active: 'dashboard',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kepala_puskesmas',
            stats,
            persenTerkendali,
            totalPasienTerkendali: jumlahTerkendali,
            totalPasienSkrining:   totalPasien,
            laporanMenunggu: menungguRes.rows.map(fmt),
            riwayatLaporan:  riwayatRes.rows.map(fmt),
        });
    } catch (err) {
        console.error('ERROR renderDashboardKepala:', err);
        res.status(500).render('partials/404', { message: 'Gagal memuat dashboard.' });
    }
};

// ─────────────────────────────────────────────────────────────
// PERSETUJUAN LAPORAN
// ─────────────────────────────────────────────────────────────
exports.renderPersetujuan = async (req, res) => {
    try {
        const semuaRes = await pool.query(`
            SELECT l.id_laporan, l.status, l.dikirim_pada,
                   l.total_pasien, l.total_skrining, l.narasi_laporan AS narasi,
                   l.catatan_tolak,
                   per.periode_bulan, per.periode_tahun,
                   u.nama_user AS nama_pj
            FROM laporan l
            JOIN periode per ON l.id_periode = per.periode_id
            JOIN "user"  u   ON l.id_pj      = u.id_user
            WHERE l.status != 'draft'
            ORDER BY l.dikirim_pada DESC
        `);

        const laporanList = semuaRes.rows.map(row => ({
            ...row,
            nama_bulan: NAMA_BULAN[(parseInt(row.periode_bulan) - 1)] || '-'
        }));

        let detailLaporan   = null;
        let distribusiNagari = [];

        if (req.query.id) {
            const detRes = await pool.query(`
                SELECT l.*, per.periode_bulan, per.periode_tahun, u.nama_user AS nama_pj
                FROM laporan l
                JOIN periode per ON l.id_periode = per.periode_id
                JOIN "user"  u   ON l.id_pj      = u.id_user
                WHERE l.id_laporan = $1
            `, [req.query.id]);

            if (detRes.rows.length > 0) {
                detailLaporan = {
                    ...detRes.rows[0],
                    nama_bulan: NAMA_BULAN[(parseInt(detRes.rows[0].periode_bulan) - 1)] || '-'
                };

                const nagariRes = await pool.query(`
                    SELECT
                        n.nama_nagari,
                        COUNT(DISTINCT s.id_pasien)::int AS total_pasien,
                        COUNT(CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 1 END)::int AS hipertensi,
                        COUNT(CASE WHEN s.sistole < 140 AND s.diastole < 90  THEN 1 END)::int AS terkendali
                    FROM skrining s
                    JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
                    JOIN pasien p   ON s.id_pasien   = p.id_pasien
                    JOIN jorong j   ON p.id_jorong   = j.id_jorong
                    JOIN nagari n   ON j.id_nagari   = n.id_nagari
                    WHERE s.status_validasi = 'terverifikasi'
                      AND k.id_periode = $1
                    GROUP BY n.nama_nagari
                    ORDER BY total_pasien DESC
                `, [detRes.rows[0].id_periode]);
                distribusiNagari = nagariRes.rows;
            }
        }

        res.render('kepala/persetujuan', {
            active: 'persetujuan',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kepala_puskesmas',
            laporanList,
            detailLaporan,
            distribusiNagari,
        });
    } catch (err) {
        console.error('ERROR renderPersetujuan:', err);
        res.status(500).render('partials/404', { message: 'Gagal memuat persetujuan.' });
    }
};

// POST: Setujui laporan
exports.handleSetujuiLaporan = async (req, res) => {
    const { id_laporan } = req.params;
    try {
        // Cek kolom opsional disetujui_oleh
        const colCheck = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name='laporan' AND column_name='disetujui_oleh'
        `);
        if (colCheck.rows.length > 0) {
            await pool.query(`
                UPDATE laporan
                SET status='disetujui', disetujui_pada=NOW(),
                    disetujui_oleh=$1, catatan_tolak=NULL
                WHERE id_laporan=$2 AND status='dikirim'
            `, [req.session.user.id_user, id_laporan]);
        } else {
            await pool.query(`
                UPDATE laporan
                SET status='disetujui', disetujui_pada=NOW(), catatan_tolak=NULL
                WHERE id_laporan=$1 AND status='dikirim'
            `, [id_laporan]);
        }
        res.redirect('/kepala/persetujuan');
    } catch (err) {
        console.error('ERROR handleSetujuiLaporan:', err);
        res.redirect('/kepala/persetujuan');
    }
};

// POST: Tolak laporan
exports.handleTolakLaporan = async (req, res) => {
    const { id_laporan } = req.params;
    const { catatan_tolak } = req.body;
    try {
        await pool.query(`
            UPDATE laporan
            SET status='ditolak', catatan_tolak=$1
            WHERE id_laporan=$2 AND status='dikirim'
        `, [catatan_tolak || 'Tidak ada catatan.', id_laporan]);
        res.redirect('/kepala/persetujuan');
    } catch (err) {
        console.error('ERROR handleTolakLaporan:', err);
        res.redirect('/kepala/persetujuan');
    }
};

// GET: Unduh laporan final (khusus Kepala, hanya yang sudah disetujui)
exports.unduhLaporanKepala = async (req, res) => {
    const { id_laporan } = req.params;
    // Validasi: hanya laporan berstatus disetujui yang bisa diunduh
    try {
        const cek = await pool.query(
            `SELECT status FROM laporan WHERE id_laporan=$1`, [id_laporan]
        );
        if (!cek.rows.length || cek.rows[0].status !== 'disetujui') {
            return res.status(403).send('Laporan belum disetujui atau tidak ditemukan.');
        }
        // Teruskan ke fungsi export yang sudah ada di laporanController
        req.params.id_laporan = id_laporan;
        const laporanController = require('./laporanController');
        return laporanController.exportLaporanExcel(req, res);
    } catch (err) {
        console.error('ERROR unduhLaporanKepala:', err);
        res.status(500).send('Gagal mengunduh laporan.');
    }
};

// ─────────────────────────────────────────────────────────────
// GRAFIK KUNJUNGAN & REKAP CAPAIAN
// ─────────────────────────────────────────────────────────────
exports.renderGrafikKunjungan = async (req, res) => {
    try {
        const kunjunganRes = await pool.query(`
            SELECT
                per.periode_bulan AS bulan, per.periode_tahun AS tahun,
                COUNT(s.id_skrining)::int          AS total_skrining,
                COUNT(DISTINCT s.id_pasien)::int   AS total_pasien,
                COUNT(CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 1 END)::int AS hipertensi
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN periode per ON k.id_periode  = per.periode_id
            WHERE s.status_validasi = 'terverifikasi'
            GROUP BY per.periode_tahun, per.periode_bulan
            ORDER BY per.periode_tahun, per.periode_bulan
            LIMIT 12
        `);

        const grafikData = kunjunganRes.rows.map(row => ({
            ...row,
            label: `${NAMA_BULAN[parseInt(row.bulan) - 1]} ${row.tahun}`
        }));

        const rekapPeriodeRes = await pool.query(`
            SELECT
                per.periode_bulan, per.periode_tahun,
                COUNT(DISTINCT s.id_pasien)::int AS total_pasien,
                COUNT(s.id_skrining)::int         AS total_skrining,
                COUNT(CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 1 END)::int AS hipertensi,
                COUNT(CASE WHEN s.sistole < 140  AND s.diastole < 90  THEN 1 END)::int AS terkendali
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN periode per ON k.id_periode  = per.periode_id
            WHERE s.status_validasi = 'terverifikasi'
            GROUP BY per.periode_tahun, per.periode_bulan
            ORDER BY per.periode_tahun DESC, per.periode_bulan DESC
        `);

        const rekapPeriode = rekapPeriodeRes.rows.map(row => ({
            ...row,
            nama_bulan: NAMA_BULAN[(parseInt(row.periode_bulan) - 1)] || '-',
            persen_capaian: row.total_pasien > 0
                ? ((row.terkendali / row.total_pasien) * 100).toFixed(1) : '0.0'
        }));

        const nagariRes = await pool.query(`
            SELECT
                n.nama_nagari,
                COUNT(DISTINCT s.id_pasien)::int AS total_pasien,
                COUNT(CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 1 END)::int AS hipertensi,
                COUNT(CASE WHEN s.sistole < 140  AND s.diastole < 90  THEN 1 END)::int AS terkendali
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            WHERE s.status_validasi = 'terverifikasi'
            GROUP BY n.nama_nagari
            ORDER BY total_pasien DESC
        `);

        res.render('kepala/grafikkunjungan', {
            active: 'grafikkunjungan',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'kepala_puskesmas',
            grafikData,
            rekapPeriode,
            capaianNagari: nagariRes.rows,
        });
    } catch (err) {
        console.error('ERROR renderGrafikKunjungan:', err);
        res.status(500).render('partials/404', { message: 'Gagal memuat grafik.' });
    }
};
