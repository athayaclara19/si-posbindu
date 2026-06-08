const { 
    renderKelolaTarget, 
    handleSimpanTargetGlobal, 
    handleEditTargetNagari, 
    handleHapusTarget 
} = require('../controllers/targetController');

router.get('/target', renderKelolaTarget);
router.post('/target/global', handleSimpanTargetGlobal);      // simpan target global
router.post('/target/nagari/edit', handleEditTargetNagari);   // edit per nagari
router.post('/target/hapus/:tahun', handleHapusTarget);       // hapus 1 tahun