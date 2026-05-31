const express = require('express');
const router  = express.Router();

const { isAuthenticated, isAuthorized } = require('../middleware/auth');
const ptmController     = require('../controllers/ptmController');
const userController    = require('../controllers/userController');
const targetController  = require('../controllers/targetController');
const jadwalController  = require('../controllers/jadwalController');
const laporanController = require('../controllers/laporanController');
const rekapController   = require('../controllers/rekapController');

const guard = [isAuthenticated, isAuthorized('pj_ptm')];

// --- Dashboard ---
router.get('/', isAuthenticated, ptmController.renderDashboardPTM);

// --- Rekap ---
router.get('/rekap', ...guard, rekapController.renderRekapPTM);

// --- Target ---
router.get('/target',          ...guard, targetController.renderKelolaTarget);
router.post('/target/simpan',  ...guard, targetController.handleSimpanTarget);
router.post('/target/hapus/:id', ...guard, targetController.handleHapusTarget);

// --- Kelola User ---
router.get('/user',                ...guard, userController.renderKelolaUser);
router.post('/user/tambah',        ...guard, userController.handleTambahUser);
router.get('/user/edit/:id',       ...guard, userController.renderEditUser);
router.post('/user/update',        ...guard, userController.handleUpdateUser);
router.post('/user/toggle/:id',    ...guard, userController.handleToggleAktif);
router.post('/user/reset/:id',     ...guard, userController.handleResetPassword);

// --- Kelola Pasien ---
router.get('/pasien',              ...guard, ptmController.renderKelolaPasien);
router.get('/pasien/edit/:id',     ...guard, ptmController.renderEditPasien);
router.post('/pasien/update',      ...guard, ptmController.handleUpdatePasien);
router.post('/pasien/delete/:id',  ...guard, ptmController.handleDeletePasien);

// --- Jadwal ---
router.get('/jadwal',              ...guard, jadwalController.renderJadwalPTM);
router.post('/jadwal/tambah',      ...guard, jadwalController.handleTambahJadwal);
router.get('/jadwal/edit/:id',     ...guard, jadwalController.renderEditJadwal);
router.post('/jadwal/edit/:id',    ...guard, jadwalController.handleEditJadwal);
router.post('/jadwal/hapus/:id',   ...guard, jadwalController.handleHapusJadwal);
router.get('/jadwal/detail/:id',   isAuthenticated, jadwalController.getDetailJadwal);

// --- Laporan ---
router.get('/laporan',              ...guard, laporanController.renderLaporanPTM);
router.get('/laporan/preview',      ...guard, laporanController.getPreviewData);
router.post('/laporan/generate',    ...guard, laporanController.generateLaporan);
router.post('/laporan/kirim/:id_laporan',  ...guard, laporanController.kirimLaporan);
router.get('/laporan/export/:id_laporan',  ...guard, laporanController.exportLaporanExcel);

module.exports = router;
