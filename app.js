// ============================================================
// FILE: app.js (VERSI MODIFIKASI - Backend Lengkap)
// ============================================================

const express = require('express');
const path    = require('path');
const session = require('express-session'); // BARU: Session management
require('dotenv').config();                 // BARU: Memuat file .env
const pool = require('./src/config/db');
const petaController = require('./src/controllers/petaController');

const app = express();

// ============================================================
// BAGIAN 1: ENGINE & STATIC FILES (Tidak berubah)
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// BAGIAN 2: MIDDLEWARE PARSER (BARU)
// Diperlukan agar Express bisa membaca data dari form HTML (POST request)
// ============================================================
app.use(express.urlencoded({ extended: true })); // Untuk form HTML biasa
app.use(express.json());                          // Untuk request JSON (API)

// ============================================================
// BAGIAN 3: KONFIGURASI SESSION (BARU)
//
// Session adalah cara server "mengingat" siapa user yang sedang login.
// Cara kerjanya: Server menyimpan data (mis: id_user, role) di memori,
// lalu mengirimkan ID unik (session ID) ke browser dalam bentuk Cookie.
// Setiap request berikutnya, browser mengirim Cookie itu kembali,
// dan server tahu siapa yang sedang request.
// ============================================================
app.use(session({
    secret: process.env.SESSION_SECRET, // Kunci rahasia untuk enkripsi session ID
    resave: false,            // Jangan simpan ulang session jika tidak ada perubahan
    saveUninitialized: false, // Jangan buat session untuk user yang belum login
    cookie: {
        secure: false,        // Set ke TRUE jika pakai HTTPS di production
        httpOnly: true,       // Cookie tidak bisa diakses via JavaScript browser (lebih aman)
        maxAge: 1000 * 60 * 60 * 8 // Cookie expired setelah 8 jam (dalam milidetik)
    }
}));

// ============================================================
// BAGIAN 4: MIDDLEWARE LOKAL UNTUK EJS (BARU)
//
// Ini adalah "jembatan" antara data session dan template EJS.
// Dengan res.locals, variabel 'currentUser' bisa langsung dipakai
// di SEMUA file .ejs tanpa harus passing manual di setiap res.render().
//
// Contoh penggunaan di file .ejs:
//   <p>Halo, <%= currentUser ? currentUser.nama_user : 'Tamu' %>!</p>
//   <% if (currentUser && currentUser.role === 'kader') { %>
//     <a href="/skrining">Input Skrining</a>
//   <% } %>
// ============================================================
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    next();
});

// ============================================================
// BAGIAN 5: FUNGSI MIDDLEWARE RBAC (Role-Based Access Control)
//
// Ini adalah "penjaga pintu" untuk setiap halaman.
// Cara kerjanya seperti ini:
//   isAuthenticated   -> Cek: apakah user sudah login?
//   isAuthorized(...) -> Cek: apakah role user DIIZINKAN masuk?
//
// Cara menggunakannya di route:
//   app.get('/skrining', isAuthenticated, isAuthorized('kader'), handler)
//   app.get('/bidan',    isAuthenticated, isAuthorized('bidan', 'pj_ptm'), handler)
// ============================================================

/**
 * Middleware 1: Cek apakah user sudah login.
 * Jika belum, redirect ke halaman login.
 */
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next(); // User sudah login, lanjutkan ke handler berikutnya
    }
    // Belum login, kirim ke halaman login
    res.redirect('/login');
};

/**
 * Middleware 2: Cek apakah role user sesuai dengan yang diizinkan.
 * Menerima satu atau lebih role yang diperbolehkan.
 * @param {...string} allowedRoles - Role yang boleh mengakses halaman ini
 */
const isAuthorized = (...allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.session.user?.role;
        if (allowedRoles.includes(userRole)) {
            return next(); // Role cocok, lanjutkan
        }
        // Role tidak cocok, kirim pesan 403 Forbidden
        // Di production, sebaiknya render halaman error yang cantik
        res.status(403).send('<h1>403 - Akses Ditolak</h1><p>Anda tidak memiliki izin untuk mengakses halaman ini.</p><a href="/">Kembali</a>');
    };
};

// Ekspor middleware agar bisa digunakan di file router terpisah nanti
// (Saat ini digunakan langsung di app.js untuk kemudahan)


// ============================================================
// BAGIAN 6: ROUTES
// ============================================================

// --- RUTE PUBLIK (Tidak perlu login) ---
app.use('/', require('./src/routes/auth'));


// --- RUTE KADER (Hanya untuk role 'kader') ---
const kaderController = require('./src/controllers/kaderControllers');
const jadwalController = require('./src/controllers/jadwalController');

app.get('/', isAuthenticated, isAuthorized('kader'), kaderController.renderDashboard);

app.get('/jadwal',
    isAuthenticated,
    isAuthorized('kader'),
    jadwalController.renderJadwalKader
);

app.get('/skrining', 
    isAuthenticated, 
    isAuthorized('kader'), kaderController.renderInputSkrining);

app.post('/skrining', 
    isAuthenticated, 
    isAuthorized('kader'), kaderController.handleInputSkrining);

app.get('/riwayat', 
    isAuthenticated, 
    isAuthorized('kader'), kaderController.renderRiwayat);


// --- RUTE EDIT SKRINING (Kader) ---
app.get('/skrining/edit/:id_skrining', isAuthenticated, isAuthorized('kader'), kaderController.renderEditSkrining);
app.post('/skrining/edit/:id_skrining', isAuthenticated, isAuthorized('kader'), kaderController.handleEditSkrining);

// --- RUTE BIDAN (Hanya untuk role 'bidan') ---
const bidanController = require('./src/controllers/bidanController');
const monitoringController = require('./src/controllers/monitoringController');
const laporanController = require('./src/controllers/laporanController');
const rekapController = require('./src/controllers/rekapController');

console.log("CEK ISI CONTROLLER BIDAN:", bidanController);

// PERBAIKAN: Gunakan controller untuk dashboard bidan
app.get('/bidan',
    isAuthenticated,
    isAuthorized('bidan'),
    bidanController.renderDashboard 
);

app.get('/bidan/validasi', 
    isAuthenticated, 
    isAuthorized('bidan'), bidanController.renderValidasi);

app.post('/bidan/validasi/:id_skrining', 
    isAuthenticated, 
    isAuthorized('bidan'), bidanController.handleActionValidasi);
    
app.get('/bidan/rekap',
    isAuthenticated,
    isAuthorized('bidan'),
    rekapController.renderRekapBidan
);

app.get('/bidan/monitoring',
    isAuthenticated,
    isAuthorized('bidan'),
    monitoringController.renderMonitoring
);

app.get('/bidan/monitoring/:id_pasien',
    isAuthenticated,
    isAuthorized('bidan'),
    monitoringController.renderGrafikTensi
);

app.get('/bidan/laporan', 
    isAuthenticated, 
    isAuthorized('bidan'), bidanController.renderLaporan);

app.get('/bidan/laporan/export', 
    isAuthenticated, 
    isAuthorized('bidan'), bidanController.exportLaporanExcel);


// --- RUTE PJ PTM (Hanya untuk role 'pj_ptm') ---
const ptmController = require('./src/controllers/ptmController');

// KODE BARU
app.get('/ptm', 
    isAuthenticated, 
    ptmController.renderDashboardPTM);

app.get('/ptm/rekap',
    isAuthenticated,
    isAuthorized('pj_ptm'),
    rekapController.renderRekapPTM
);

app.get('/ptm/laporan',
    isAuthenticated, 
    isAuthorized('pj_ptm'), 
    laporanController.renderLaporanPTM
);

app.get('/ptm/laporan/preview',
    isAuthenticated,
    isAuthorized('pj_ptm'),
    laporanController.getPreviewData
);


app.post('/ptm/laporan/generate',
    isAuthenticated, 
    isAuthorized('pj_ptm'), 
    laporanController.generateLaporan
);

app.post('/ptm/laporan/kirim/:id_laporan',
    isAuthenticated, 
    isAuthorized('pj_ptm'), 
    laporanController.kirimLaporan
);

app.get('/ptm/jadwal', 
    isAuthenticated, 
    isAuthorized('pj_ptm'), 
    jadwalController.renderJadwalPTM
);

app.post('/ptm/jadwal/tambah', 
    isAuthenticated, 
    isAuthorized('pj_ptm'), 
    jadwalController.handleTambahJadwal
);


// --- RUTE KELOLA PASIEN PTM ---
// BUG FIX: Route sebelumnya tidak punya isAuthenticated & isAuthorized
// sehingga saat user klik menu lain dari halaman kelolapasien, server
// tidak tahu user siapa dan langsung tolak dengan 403.
// Sekarang semua route /ptm/pasien dilindungi middleware yang benar.

// 1. Daftar semua pasien
app.get('/ptm/pasien',
    isAuthenticated,
    isAuthorized('pj_ptm'),
    ptmController.renderKelolaPasien
);

// 2. Form edit pasien
app.get('/ptm/pasien/edit/:id',
    isAuthenticated,
    isAuthorized('pj_ptm'),
    ptmController.renderEditPasien
);

// 3. Proses update data pasien
app.post('/ptm/pasien/update',
    isAuthenticated,
    isAuthorized('pj_ptm'),
    ptmController.handleUpdatePasien
);

// 4. Proses hapus data pasien
app.post('/ptm/pasien/delete/:id',
    isAuthenticated,
    isAuthorized('pj_ptm'),
    ptmController.handleDeletePasien
);

app.get('/ptm/laporan/export/:id_laporan', 
    isAuthenticated, isAuthorized('pj_ptm'), 
    laporanController.exportLaporanExcel);


// --- RUTE KEPALA PUSKESMAS (Hanya untuk role 'kepala_puskesmas') ---
const kepalaController = require('./src/controllers/kepalaController');

// Dashboard Kepala Puskesmas
app.get('/kepala',
    isAuthenticated,
    isAuthorized('kepala_puskesmas'),
    kepalaController.renderDashboardKepala
);

// Persetujuan laporan (Activity 30–33)
app.get('/kepala/persetujuan',
    isAuthenticated,
    isAuthorized('kepala_puskesmas'),
    kepalaController.renderPersetujuan
);

app.post('/kepala/persetujuan/setujui/:id_laporan',
    isAuthenticated,
    isAuthorized('kepala_puskesmas'),
    kepalaController.handleSetujuiLaporan
);

app.post('/kepala/persetujuan/tolak/:id_laporan',
    isAuthenticated,
    isAuthorized('kepala_puskesmas'),
    kepalaController.handleTolakLaporan
);

// Grafik kunjungan & rekap per periode - Activity 34 & 29
app.get('/kepala/grafikkunjungan',
    isAuthenticated,
    isAuthorized('kepala_puskesmas'),
    kepalaController.renderGrafikKunjungan
);

app.get('/kepala/peta-hipertensi',
    isAuthenticated,
    isAuthorized('kepala_puskesmas'),
    petaController.renderPetaHipertensi
);
app.get('/api/peta-hipertensi',
    isAuthenticated,
    isAuthorized('kepala_puskesmas'),
    petaController.getDataPetaHipertensi
);

const pasienController = require('./src/controllers/pasienController.js');

// --- RUTE MANAJEMEN PASIEN (Kader) ---
// --- UBAH PASSWORD (semua role) ---
app.post('/ubah-password', isAuthenticated, async (req, res) => {
    const { password_lama, password_baru, konfirmasi_password } = req.body;
    const id_user = req.session.user.id_user;
    try {
        if (password_baru !== konfirmasi_password) {
            return res.redirect('back');
        }
        const result = await pool.query('SELECT * FROM "user" WHERE id_user=$1', [id_user]);
        const user = result.rows[0];
        const bcrypt = require('bcryptjs');
        const isMatch = await bcrypt.compare(password_lama, user.password);
        if (!isMatch) return res.redirect('back');
        const hash = await bcrypt.hash(password_baru, 10);
        await pool.query('UPDATE "user" SET password=$1 WHERE id_user=$2', [hash, id_user]);
        // Redirect ke dashboard sesuai role
        const roleMap = { kader:'/', bidan:'/bidan', pj_ptm:'/ptm', kepala_puskesmas:'/kepala' };
        res.redirect(roleMap[req.session.user.role] || '/');
    } catch (err) {
        console.error(err);
        res.redirect('back');
    }
});

app.get('/pasien', isAuthenticated, isAuthorized('kader'), pasienController.renderDaftarPasien);
app.get('/pasien/tambah', isAuthenticated, isAuthorized('kader'), pasienController.renderTambahPasien);
app.post('/pasien/tambah', isAuthenticated, isAuthorized('kader'), pasienController.handleTambahPasien);

// ============================================================
// BAGIAN 7: HELPER FUNCTION
// ============================================================

/**
 * Redirect user ke dashboard yang sesuai dengan role-nya setelah login.
 * @param {object} res - Express response object
 * @param {string} role - Role dari user yang baru login
 */
function redirectByRole(res, role) {
    const roleDestination = {
        'kader':             '/',
        'bidan':             '/bidan',
        'pj_ptm':            '/ptm',
        'kepala_puskesmas':  '/kepala',
    };
    const destination = roleDestination[role] || '/login';
    res.redirect(destination);
}


// ============================================================
// BAGIAN 8: START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    console.log(`📌 Mode: ${process.env.NODE_ENV || 'development'}`);
});
