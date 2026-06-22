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
// BAGIAN 4b: NOTIFIKASI GLOBAL (semua role)
// Mengisi res.locals.notifikasi secara otomatis di SETIAP
// request berdasarkan role yang login, supaya ikon bel di
// header selalu konsisten di semua halaman — tidak perlu
// ditambahkan manual di tiap controller.
// Catatan: kalau sebuah controller memanggil res.render(view,
// { notifikasi: [...] }) secara eksplisit (misalnya dashboard
// kader yang sudah punya logika detail), nilai eksplisit itu
// akan menimpa nilai default dari middleware ini.
// ============================================================
app.use(async (req, res, next) => {
    const user = req.session.user;
    if (!user) { res.locals.notifikasi = []; return next(); }

    try {
        let rows = [];

        if (user.role === 'kader') {
            // Skrining milik kader ini yang ditolak/disetujui bidan
            const r = await pool.query(`
                SELECT s.id_skrining, p.nama_pasien, s.status_validasi, s.catatan_bidan
                FROM skrining s
                JOIN pasien p ON s.id_pasien = p.id_pasien
                WHERE s.id_kader = $1 AND s.status_validasi IN ('revisi', 'terverifikasi')
                ORDER BY s.tanggal_skrining DESC LIMIT 10
            `, [user.id_user]);
            rows = r.rows.map(n => ({
                tipe: n.status_validasi === 'revisi' ? 'revisi' : 'disetujui',
                pesan: n.status_validasi === 'revisi'
                    ? `Skrining ${n.nama_pasien} ditolak: ${n.catatan_bidan || 'Perlu diperbaiki'}`
                    : `Skrining ${n.nama_pasien} telah disetujui`,
                id_skrining: n.id_skrining
            }));

        } else if (user.role === 'bidan') {
            // Skrining baru dari kader yang belum divalidasi
            const r = await pool.query(`
                SELECT s.id_skrining, p.nama_pasien
                FROM skrining s
                JOIN pasien p ON s.id_pasien = p.id_pasien
                WHERE s.status_validasi = 'menunggu'
                ORDER BY s.tanggal_skrining DESC LIMIT 10
            `);
            rows = r.rows.map(n => ({
                tipe: 'menunggu',
                pesan: `Skrining baru ${n.nama_pasien} menunggu validasi Anda`,
                link: '/bidan/validasi'
            }));

        } else if (user.role === 'pj_ptm') {
            // Laporan yang ditolak Kepala Puskesmas (perlu direvisi/kirim ulang)
            // dan laporan yang baru disetujui (informasi)
            const r = await pool.query(`
                SELECT id_laporan, status, catatan_tolak
                FROM laporan
                WHERE status IN ('ditolak', 'disetujui')
                ORDER BY id_laporan DESC LIMIT 10
            `);
            rows = r.rows.map(n => ({
                tipe: n.status === 'ditolak' ? 'ditolak' : 'disetujui',
                pesan: n.status === 'ditolak'
                    ? `Laporan ditolak Kepala Puskesmas: ${n.catatan_tolak || 'Perlu diperbaiki'}`
                    : `Laporan telah disetujui Kepala Puskesmas`,
                link: '/ptm/laporan'
            }));

        } else if (user.role === 'kepala_puskesmas') {
            // Laporan baru dari PJ PTM yang menunggu persetujuan
            const r = await pool.query(`
                SELECT id_laporan
                FROM laporan
                WHERE status = 'dikirim'
                ORDER BY id_laporan DESC LIMIT 10
            `);
            rows = r.rows.map(n => ({
                tipe: 'dikirim',
                pesan: `Ada laporan baru menunggu persetujuan Anda`,
                link: '/kepala/persetujuan'
            }));
        }

        res.locals.notifikasi = rows;
    } catch (err) {
        console.error('ERROR NOTIFIKASI GLOBAL:', err);
        res.locals.notifikasi = [];
    }
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
    const roleMap = { kader: '/', bidan: '/bidan', pj_ptm: '/ptm', kepala_puskesmas: '/kepala' };
    const dashboardUrl = roleMap[req.session.user.role] || '/';

    try {
        // Validasi: password baru dan konfirmasi tidak sama
        if (password_baru !== konfirmasi_password) {
            req.session.errorMessage = 'Password baru dan konfirmasi tidak sama.';
            return res.redirect(dashboardUrl);
        }

        // Validasi: password baru minimal 6 karakter
        if (!password_baru || password_baru.trim().length < 6) {
            req.session.errorMessage = 'Password baru minimal 6 karakter.';
            return res.redirect(dashboardUrl);
        }

        const result = await pool.query('SELECT * FROM "user" WHERE id_user=$1', [id_user]);
        const user   = result.rows[0];
        const bcrypt = require('bcryptjs');
        const isMatch = await bcrypt.compare(password_lama, user.password);

        // Validasi: password lama salah
        if (!isMatch) {
            req.session.errorMessage = 'Password lama tidak sesuai.';
            return res.redirect(dashboardUrl);
        }

        const hash = await bcrypt.hash(password_baru, 10);
        await pool.query('UPDATE "user" SET password=$1 WHERE id_user=$2', [hash, id_user]);

        req.session.successMessage = 'Password berhasil diubah.';
        res.redirect(dashboardUrl);

    } catch (err) {
        console.error(err);
        req.session.errorMessage = 'Terjadi kesalahan sistem. Coba lagi.';
        res.redirect(dashboardUrl);
    }
});

// ============================================================
// BAGIAN 6b: UBAH PROFIL SENDIRI (semua role)
// ============================================================
app.post('/update-profil', isAuthenticated, require('./src/controllers/userController').handleUpdateProfilSendiri);

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
