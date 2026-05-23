// ============================================================
// FILE: src/controllers/targetController.js
// Fungsi: Mengelola target capaian tahunan
//         (hanya bisa diakses oleh pj_ptm)
// ============================================================

const pool = require('../config/db');

// ─────────────────────────────────────────────
// 1. Tampilkan Halaman Kelola Target
// ─────────────────────────────────────────────
exports.renderKelolaTarget = async (req, res) => {
    try {
        const tahunIni = new Date().getFullYear();

        // Ambil semua target yang sudah pernah diset, urutkan terbaru dulu
        const resTarget = await pool.query(`
            SELECT * FROM target_tahunan ORDER BY tahun DESC
        `);

        res.render('ptm/kelolatarget', {
            active: 'target',
            currentUser:    req.session.user || null,
            targets:        resTarget.rows,
            tahunIni,
            successMessage: req.session.successMessage || null,
            errorMessage:   req.session.errorMessage   || null,
        });

        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('ERROR RENDER KELOLA TARGET:', err);
        res.status(500).send('Gagal memuat halaman kelola target.');
    }
};

// ─────────────────────────────────────────────
// 2. Simpan / Update Target Total Tahunan
// ─────────────────────────────────────────────
exports.handleSimpanTarget = async (req, res) => {
    const { tahun, target_total, catatan } = req.body;

    try {
        if (!tahun || !target_total || isNaN(tahun) || isNaN(target_total)) {
            req.session.errorMessage = 'Tahun dan target total harus diisi dengan angka yang valid.';
            return res.redirect('/ptm/target');
        }
        if (parseInt(target_total) <= 0) {
            req.session.errorMessage = 'Target total harus lebih dari 0.';
            return res.redirect('/ptm/target');
        }

        // UPSERT: kalau tahun sudah ada → update, kalau belum → insert
        await pool.query(`
            INSERT INTO target_tahunan (tahun, target_total, catatan, diubah_pada)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (tahun)
            DO UPDATE SET
                target_total = EXCLUDED.target_total,
                catatan      = EXCLUDED.catatan,
                diubah_pada  = NOW()
        `, [parseInt(tahun), parseInt(target_total), catatan || null]);

        req.session.successMessage = `Target tahun ${tahun} berhasil disimpan: ${parseInt(target_total).toLocaleString('id-ID')} pasien.`;
        res.redirect('/ptm/target');

    } catch (err) {
        console.error('ERROR SIMPAN TARGET:', err);
        req.session.errorMessage = 'Gagal menyimpan target. Terjadi kesalahan sistem.';
        res.redirect('/ptm/target');
    }
};

// ─────────────────────────────────────────────
// 3. Hapus Target Tahun Tertentu
// ─────────────────────────────────────────────
exports.handleHapusTarget = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'DELETE FROM target_tahunan WHERE id_target = $1 RETURNING tahun',
            [id]
        );
        if (result.rows.length > 0) {
            req.session.successMessage = `Target tahun ${result.rows[0].tahun} berhasil dihapus.`;
        }
        res.redirect('/ptm/target');
    } catch (err) {
        console.error('ERROR HAPUS TARGET:', err);
        req.session.errorMessage = 'Gagal menghapus target.';
        res.redirect('/ptm/target');
    }
};

// ─────────────────────────────────────────────
// 4. Helper: Ambil target untuk tahun tertentu
//    (dipakai oleh renderDashboardPTM)
// ─────────────────────────────────────────────
exports.getTargetByTahun = async (tahun) => {
    const result = await pool.query(
        'SELECT target_total FROM target_tahunan WHERE tahun = $1',
        [tahun]
    );
    return result.rows.length > 0 ? parseInt(result.rows[0].target_total) : 2000;
};