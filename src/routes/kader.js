const express = require('express');
const router  = express.Router();

const { isAuthenticated, isAuthorized } = require('../middleware/auth');
const kaderController  = require('../controllers/kaderControllers');
const jadwalController = require('../controllers/jadwalController');
const pasienController = require('../controllers/pasienController');

const guard = [isAuthenticated, isAuthorized('kader')];

// --- Dashboard ---
router.get('/', ...guard, kaderController.renderDashboard);

// --- Jadwal ---
router.get('/jadwal', ...guard, jadwalController.renderJadwalKader);

// --- Skrining ---
router.get('/skrining',  ...guard, kaderController.renderInputSkrining);
router.post('/skrining', ...guard, kaderController.handleInputSkrining);

// --- Edit Skrining ---
router.get('/skrining/edit/:id_skrining',  ...guard, kaderController.renderEditSkrining);
router.post('/skrining/edit/:id_skrining', ...guard, kaderController.handleEditSkrining);

// --- Riwayat ---
router.get('/riwayat', ...guard, kaderController.renderRiwayat);
router.get('/riwayat/cetak/:id_pasien/:id_kegiatan', ...guard, kaderController.renderCetakSkriningPasien);
router.get('/riwayat/cetak-semua/:id_pasien', ...guard, kaderController.renderCetakSemuaSkrining);

// --- Pasien ---
router.get('/pasien',          ...guard, pasienController.renderDaftarPasien);
router.get('/pasien/tambah',   ...guard, pasienController.renderTambahPasien);
router.post('/pasien/tambah',  ...guard, pasienController.handleTambahPasien);

module.exports = router;
