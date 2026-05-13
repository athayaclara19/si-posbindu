const pool = require('../config/db');

exports.renderDashboardKepala = async (req, res) => {
    try {
        // 1. Rekap Statistik Status Laporan
        const qLaporanStats = `
            SELECT
                COUNT(CASE WHEN status = 'dikirim' THEN 1 END) as menunggu,
                COUNT(CASE WHEN status = 'disahkan' THEN 1 END) as disahkan,
                COUNT(CASE WHEN status = 'ditolak' THEN 1 END) as ditolak,
                COUNT(id_laporan) as total
            FROM laporan
            WHERE status != 'draft' -- Tidak menghitung laporan yang masih di-draft oleh PJ PTM
        `;
        const resLaporanStats = await pool.query(qLaporanStats);
        const stats = resLaporanStats.rows[0];

        // 2. Kualitas Pengendalian PTM (Persentase Terkendali untuk Executive Summary)
        const qTerkendali = `
            SELECT 
                COUNT(DISTINCT s.id_pasien) as total_pasien,
                COUNT(DISTINCT CASE WHEN s.sistole < 140 AND s.diastole < 90 THEN s.id_pasien END) as terkendali
            FROM skrining s
            WHERE s.status_validasi = 'terverifikasi'
        `;
        const resTerkendali = await pool.query(qTerkendali);
        const totalPasien = parseInt(resTerkendali.rows[0].total_pasien) || 0;
        const terkendali = parseInt(resTerkendali.rows[0].terkendali) || 0;
        const persenTerkendali = totalPasien > 0 ? ((terkendali / totalPasien) * 100).toFixed(1) : 0;

        // 3. Laporan Menunggu (Laporan yang butuh direview Kepala Puskesmas)
        const qMenunggu = `
            SELECT l.*, per.periode_bulan, per.periode_tahun, u.nama_user as nama_pj
            FROM laporan l
            JOIN periode per ON l.id_periode = per.periode_id
            JOIN "user" u ON l.id_pj = u.id_user
            WHERE l.status = 'dikirim'
            ORDER BY l.dikirim_pada DESC
        `;
        const resMenunggu = await pool.query(qMenunggu);

        // 4. Riwayat Laporan (Sudah disahkan atau ditolak)
        const qRiwayat = `
            SELECT l.*, per.periode_bulan, per.periode_tahun, u.nama_user as nama_pj
            FROM laporan l
            JOIN periode per ON l.id_periode = per.periode_id
            JOIN "user" u ON l.id_pj = u.id_user
            WHERE l.status IN ('disahkan', 'ditolak')
            ORDER BY l.dikirim_pada DESC
            LIMIT 10
        `;
        const resRiwayat = await pool.query(qRiwayat);

        // 5. Lempar semua data ke EJS
        res.render('kepala/dashboardkepala', {
            active: 'dashboard',
            stats: stats,
            persenTerkendali: persenTerkendali,
            laporanMenunggu: resMenunggu.rows,
            riwayatLaporan: resRiwayat.rows
        });

    } catch (err) {
        console.error("ERROR RENDER DASHBOARD KEPALA:", err);
        res.status(500).send("Gagal memuat dashboard Kepala Puskesmas.");
    }
};

// =========================================================
// Fungsi Kosong Sementara (Agar app.js tidak error)
// =========================================================

exports.renderPersetujuan = async (req, res) => {
    // Nanti akan kita isi dengan logika persetujuan laporan
    res.send("Halaman Persetujuan Laporan (Sedang dalam pengembangan)");
};

exports.renderGrafikKunjungan = async (req, res) => {
    // Nanti akan kita isi dengan logika grafik
    res.send("Halaman Grafik Kunjungan (Sedang dalam pengembangan)");
};