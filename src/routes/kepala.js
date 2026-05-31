// ============================================================
// FILE: src/routes/kepala.js
// Semua route untuk role: kepala_puskesmas
// ============================================================

const express = require('express');
const router  = express.Router();

const { isAuthenticated, isAuthorized } = require('../middleware/auth');
const kepalaController = require('../controllers/kepalaController');
const petaController   = require('../controllers/petaController');

const guard = [isAuthenticated, isAuthorized('kepala_puskesmas')];

// --- Dashboard ---
router.get('/', ...guard, kepalaController.renderDashboardKepala);

// --- Persetujuan Laporan ---
router.get('/persetujuan',                           ...guard, kepalaController.renderPersetujuan);
router.post('/persetujuan/setujui/:id_laporan',      ...guard, kepalaController.handleSetujuiLaporan);
router.post('/persetujuan/tolak/:id_laporan',        ...guard, kepalaController.handleTolakLaporan);

// --- Unduh & Info Laporan ---
router.get('/laporan/unduh/:id_laporan', ...guard, kepalaController.unduhLaporanKepala);
router.get('/laporan/info/:id_laporan',  ...guard, kepalaController.infoLaporanWA);

// --- Grafik Kunjungan ---
router.get('/grafikkunjungan', ...guard, kepalaController.renderGrafikKunjungan);

// --- Peta Hipertensi ---
router.get('/peta-hipertensi', ...guard, petaController.renderPetaHipertensi);

module.exports = router;
