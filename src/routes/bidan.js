const express = require('express');
const router  = express.Router();

const { isAuthenticated, isAuthorized } = require('../middleware/auth');
const bidanController      = require('../controllers/bidanController');
const monitoringController = require('../controllers/monitoringController');
const rekapController      = require('../controllers/rekapController');

const guard = [isAuthenticated, isAuthorized('bidan')];

// --- Dashboard ---
router.get('/', ...guard, bidanController.renderDashboard);

// --- Validasi Skrining ---
router.get('/validasi',                  ...guard, bidanController.renderValidasi);
router.post('/validasi/:id_skrining',    ...guard, bidanController.handleActionValidasi);

// --- Rekap ---
router.get('/rekap', ...guard, rekapController.renderRekapBidan);

// --- Monitoring ---
router.get('/monitoring',                    ...guard, monitoringController.renderMonitoring);
router.get('/monitoring/api/:id_pasien',     ...guard, monitoringController.getApiTensiPasien);
router.get('/monitoring/:id_pasien',         ...guard, monitoringController.renderGrafikTensi);

// --- Laporan ---
router.get('/laporan',        ...guard, bidanController.renderLaporan);
router.get('/laporan/export', ...guard, bidanController.exportLaporanExcel);

module.exports = router;
