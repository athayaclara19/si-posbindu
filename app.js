// ============================================================
// FILE: app.js
// Entry point aplikasi SI Posbindu
// ============================================================

const express = require('express');
const path    = require('path');
const session = require('express-session');
require('dotenv').config();

const pool = require('./src/config/db');
const { isAuthenticated } = require('./src/middleware/auth');

const app = express();

// ============================================================
// BAGIAN 1: VIEW ENGINE & STATIC FILES
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// BAGIAN 2: MIDDLEWARE PARSER
// ============================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ============================================================
// BAGIAN 3: KONFIGURASI SESSION
// ============================================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'rahasia-posbindu',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 8 // 8 jam
    }
}));

// ============================================================
// BAGIAN 4: INJECT currentUser KE SEMUA VIEW EJS
// ============================================================
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    next();
});

// ============================================================
// BAGIAN 5: ROUTES
// ============================================================

// Publik (login / logout)
app.use('/', require('./src/routes/auth'));

// Kader — prefix: /
app.use('/', require('./src/routes/kader'));

// Bidan — prefix: /bidan
app.use('/bidan', require('./src/routes/bidan'));

// PJ PTM — prefix: /ptm
app.use('/ptm', require('./src/routes/ptm'));

// Kepala Puskesmas — prefix: /kepala
app.use('/kepala', require('./src/routes/kepala'));

// API peta — dipanggil dari view dengan fetch('/api/peta-hipertensi')
// Harus di luar prefix /kepala agar URL-nya cocok
app.get('/api/peta-hipertensi',
    isAuthenticated,
    require('./src/middleware/auth').isAuthorized('kepala_puskesmas'),
    require('./src/controllers/petaController').getDataPetaHipertensi
);

// ============================================================
// BAGIAN 6: UBAH PASSWORD (semua role)
// ============================================================
app.post('/ubah-password', isAuthenticated, async (req, res) => {
    const { password_lama, password_baru, konfirmasi_password } = req.body;
    const id_user = req.session.user.id_user;
    try {
        if (password_baru !== konfirmasi_password) {
            return res.redirect('back');
        }
        const result = await pool.query('SELECT * FROM "user" WHERE id_user=$1', [id_user]);
        const user   = result.rows[0];
        const bcrypt = require('bcryptjs');
        const isMatch = await bcrypt.compare(password_lama, user.password);
        if (!isMatch) return res.redirect('back');
        const hash = await bcrypt.hash(password_baru, 10);
        await pool.query('UPDATE "user" SET password=$1 WHERE id_user=$2', [hash, id_user]);
        const roleMap = { kader: '/', bidan: '/bidan', pj_ptm: '/ptm', kepala_puskesmas: '/kepala' };
        res.redirect(roleMap[req.session.user.role] || '/');
    } catch (err) {
        console.error(err);
        res.redirect('back');
    }
});

// ============================================================
// BAGIAN 7: START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server berjalan di http://localhost:${PORT}`);
        console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
    });
}

module.exports = app;
