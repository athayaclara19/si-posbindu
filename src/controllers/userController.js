// ============================================================
// FILE: src/controllers/userController.js
// Fungsi: Mengelola akun user (hanya bisa diakses oleh pj_ptm)
// Fitur: Lihat semua user, Tambah, Edit, Aktif/Nonaktif, Reset Password
// ============================================================

const pool   = require('../config/db');
const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────
// 1. Tampilkan Daftar Semua User
// ─────────────────────────────────────────────
exports.renderKelolaUser = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id_user,
                u.nama_user,
                u.username,
                u.role,
                u.is_active,
                j.nama_jorong,
                n.nama_nagari
            FROM "user" u
            LEFT JOIN jorong j ON u.id_jorong = j.id_jorong
            LEFT JOIN nagari n ON j.id_nagari = n.id_nagari
            ORDER BY u.role ASC, u.nama_user ASC
        `);

        const nagari = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');
        const jorong = await pool.query(`
            SELECT j.*, n.nama_nagari 
            FROM jorong j 
            JOIN nagari n ON j.id_nagari = n.id_nagari 
            ORDER BY j.nama_jorong ASC
        `);

        res.render('ptm/kelolauser', {
            users: result.rows,
            nagari: nagari.rows,
            jorong: jorong.rows,
            active: 'user',
            currentUser: req.session.user || null,
            successMessage: req.session.successMessage || null,
            errorMessage:   req.session.errorMessage   || null,
        });

        // Hapus flash message setelah ditampilkan
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('ERROR RENDER KELOLA USER:', err);
        res.status(500).send('Gagal memuat halaman kelola user.');
    }
};

// ─────────────────────────────────────────────
// 2. Proses Tambah User Baru
// ─────────────────────────────────────────────
exports.handleTambahUser = async (req, res) => {
    const { nama_user, username, password, role, id_jorong } = req.body;

    try {
        // Cek apakah username sudah dipakai
        const cek = await pool.query('SELECT id_user FROM "user" WHERE username = $1', [username]);
        if (cek.rows.length > 0) {
            req.session.errorMessage = `Username "${username}" sudah digunakan. Pilih username lain.`;
            return res.redirect('/ptm/user');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const jorongVal = (id_jorong && id_jorong !== '') ? id_jorong : null;

        await pool.query(
            `INSERT INTO "user" (nama_user, username, password, role, id_jorong, is_active)
             VALUES ($1, $2, $3, $4, $5, true)`,
            [nama_user, username, hashedPassword, role, jorongVal]
        );

        req.session.successMessage = `Akun "${nama_user}" berhasil ditambahkan.`;
        res.redirect('/ptm/user');

    } catch (err) {
        console.error('ERROR TAMBAH USER:', err);
        req.session.errorMessage = 'Gagal menambahkan user. Terjadi kesalahan sistem.';
        res.redirect('/ptm/user');
    }
};

// ─────────────────────────────────────────────
// 3. Tampilkan Form Edit User
// ─────────────────────────────────────────────
exports.renderEditUser = async (req, res) => {
    const { id } = req.params;

    try {
        const resUser   = await pool.query('SELECT * FROM "user" WHERE id_user = $1', [id]);
        const nagari    = await pool.query('SELECT * FROM nagari ORDER BY nama_nagari ASC');
        const jorong    = await pool.query(`
            SELECT j.*, n.nama_nagari 
            FROM jorong j 
            JOIN nagari n ON j.id_nagari = n.id_nagari 
            ORDER BY j.nama_jorong ASC
        `);

        if (resUser.rows.length === 0) {
            return res.status(404).send('User tidak ditemukan.');
        }

        // Cegah PJ PTM mengedit akunnya sendiri melalui halaman ini
        // (ubah password sendiri sudah ada di menu profil)
        if (parseInt(id) === req.session.user.id_user) {
            req.session.errorMessage = 'Gunakan menu Profil untuk mengubah data akun Anda sendiri.';
            return res.redirect('/ptm/user');
        }

        res.render('ptm/edituser', {
            editUser: resUser.rows[0],
            nagari: nagari.rows,
            jorong: jorong.rows,
            active: 'user',
            currentUser: req.session.user || null,
        });

    } catch (err) {
        console.error('ERROR RENDER EDIT USER:', err);
        res.status(500).send('Gagal memuat form edit user.');
    }
};

// ─────────────────────────────────────────────
// 4. Proses Update Data User
// ─────────────────────────────────────────────
exports.handleUpdateUser = async (req, res) => {
    const { id_user, nama_user, username, role, id_jorong } = req.body;

    try {
        // Cek username duplikat (kecuali milik user itu sendiri)
        const cek = await pool.query(
            'SELECT id_user FROM "user" WHERE username = $1 AND id_user != $2',
            [username, id_user]
        );
        if (cek.rows.length > 0) {
            req.session.errorMessage = `Username "${username}" sudah digunakan user lain.`;
            return res.redirect(`/ptm/user/edit/${id_user}`);
        }

        const jorongVal = (id_jorong && id_jorong !== '') ? id_jorong : null;

        await pool.query(
            `UPDATE "user" 
             SET nama_user = $1, username = $2, role = $3, id_jorong = $4
             WHERE id_user = $5`,
            [nama_user, username, role, jorongVal, id_user]
        );

        req.session.successMessage = `Data akun "${nama_user}" berhasil diperbarui.`;
        res.redirect('/ptm/user');

    } catch (err) {
        console.error('ERROR UPDATE USER:', err);
        req.session.errorMessage = 'Gagal memperbarui data user.';
        res.redirect('/ptm/user');
    }
};

// ─────────────────────────────────────────────
// 5. Proses Toggle Aktif / Nonaktif User
// ─────────────────────────────────────────────
exports.handleToggleAktif = async (req, res) => {
    const { id } = req.params;

    try {
        // Cegah PTM menonaktifkan akunnya sendiri
        if (parseInt(id) === req.session.user.id_user) {
            req.session.errorMessage = 'Anda tidak dapat menonaktifkan akun Anda sendiri.';
            return res.redirect('/ptm/user');
        }

        // Toggle: aktif ↔ nonaktif
        const result = await pool.query(
            `UPDATE "user" SET is_active = NOT is_active WHERE id_user = $1 RETURNING nama_user, is_active`,
            [id]
        );

        if (result.rows.length > 0) {
            const { nama_user, is_active } = result.rows[0];
            const status = is_active ? 'diaktifkan' : 'dinonaktifkan';
            req.session.successMessage = `Akun "${nama_user}" berhasil ${status}.`;
        }

        res.redirect('/ptm/user');

    } catch (err) {
        console.error('ERROR TOGGLE AKTIF USER:', err);
        req.session.errorMessage = 'Gagal mengubah status akun.';
        res.redirect('/ptm/user');
    }
};

// ─────────────────────────────────────────────
// 6. Proses Reset Password User
// ─────────────────────────────────────────────
exports.handleResetPassword = async (req, res) => {
    const { id } = req.params;
    const { password_baru } = req.body;

    try {
        if (!password_baru || password_baru.trim().length < 6) {
            req.session.errorMessage = 'Password baru minimal 6 karakter.';
            return res.redirect('/ptm/user');
        }

        const hashedPassword = await bcrypt.hash(password_baru, 10);

        const result = await pool.query(
            `UPDATE "user" SET password = $1 WHERE id_user = $2 RETURNING nama_user`,
            [hashedPassword, id]
        );

        if (result.rows.length > 0) {
            req.session.successMessage = `Password akun "${result.rows[0].nama_user}" berhasil direset.`;
        }

        res.redirect('/ptm/user');

    } catch (err) {
        console.error('ERROR RESET PASSWORD:', err);
        req.session.errorMessage = 'Gagal mereset password.';
        res.redirect('/ptm/user');
    }
};
