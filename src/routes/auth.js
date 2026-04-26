const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Rute untuk menampilkan halaman login
router.get('/login', authController.renderLogin);

// Rute untuk memproses data dari form login
router.post('/login', authController.handleLogin);

// Rute untuk logout
router.get('/logout', authController.handleLogout);

module.exports = router;