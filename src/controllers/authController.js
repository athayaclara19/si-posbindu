const bcrypt = require('bcryptjs');
const pool   = require('../config/db');

// 1. Tampilkan Halaman Login
exports.renderLogin = (req, res) => {
    if (req.session.user) {
        const roleMap = {
            'kader': '/', 
            'bidan': '/bidan',
            'pj_ptm': '/ptm', 
            'kepala_puskesmas': '/kepala'
        };
        return res.redirect(roleMap[req.session.user.role] || '/login');
    }
    res.render('login', { error: null });
};

// 2. Proses Login
exports.handleLogin = async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.render('login', { error: 'Username dan Password wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'SELECT * FROM "user" WHERE username = $1 AND is_active = true',
            [email]
        );
        if (result.rows.length === 0) {
            return res.render('login', { error: 'Username atau Password salah.' });
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.render('login', { error: 'Username atau Password salah.' });
        }

        // Simpan ke session — pastikan id_user dan role sinkron dengan DB
        req.session.user = {
            id_user:   user.id_user,
            nama:      user.nama_user,
            username:  user.username,
            role:      user.role,
            id_jorong: user.id_jorong,
        };

        const roleMap = {
            'kader': '/', 
            'bidan': '/bidan',
            'pj_ptm': '/ptm', 
            'kepala_puskesmas': '/kepala'
        };
        res.redirect(roleMap[user.role] || '/login');

    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Terjadi kesalahan pada server.' });
    }
};

// 3. Logout
exports.handleLogout = (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Gagal logout:', err);
        res.redirect('/login');
    });
};