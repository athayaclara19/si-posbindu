const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// 1. Tampilkan Halaman Login
exports.renderLogin = (req, res) => {
    // Jika user sudah login, langsung arahkan ke dashboardnya
    if (req.session.user) {
        const role = req.session.user.role;
        if (role === 'kader') return res.redirect('/');
        if (role === 'bidan') return res.redirect('/bidan');
        if (role === 'ptm') return res.redirect('/ptm');
        if (role === 'kepala') return res.redirect('/kepala');
    }
    // Jika belum login, tampilkan halaman login (kirim error kosong di awal)
    res.render('login', { error: null });
};

// 2. Proses Pengecekan Login
exports.handleLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Cari user berdasarkan username/email
        const result = await pool.query('SELECT * FROM "user" WHERE username = $1 AND is_active = true', [email]);
        
        // JIKA USER TIDAK DITEMUKAN
        if (result.rows.length === 0) {
            // UBAH PESANNYA DI SINI
            return res.render('login', { error: 'Username/Email atau Password salah.' });
        }

        const user = result.rows[0];

        // Bandingkan password yang diketik dengan password hash di database
        const isMatch = await bcrypt.compare(password, user.password);

        // JIKA PASSWORD SALAH
        if (!isMatch) {
            // UBAH PESANNYA DI SINI JUGA (Sama Persis)
            return res.render('login', { error: 'Username/Email atau Password salah.' });
        }

        // Jika sukses, simpan data ke session
        req.session.user = {
            id: user.id_user,
            nama: user.nama_user,
            role: user.role
        };

        // Redirect ke dashboard sesuai role
        if (user.role === 'kader') res.redirect('/');
        else if (user.role === 'bidan') res.redirect('/bidan');
        else if (user.role === 'ptm') res.redirect('/ptm');
        else if (user.role === 'kepala') res.redirect('/kepala');

    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Terjadi kesalahan pada server.' });
    }
};

// 3. Proses Logout
exports.handleLogout = (req, res) => {
    // Menghancurkan session
    req.session.destroy((err) => {
        if(err) {
            console.error("Gagal logout:", err);
            return res.status(500).send("Gagal logout");
        }
        // Redirect ke halaman login setelah berhasil
        res.redirect('/login');
    });
};