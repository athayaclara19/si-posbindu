// ============================================================
// FILE: src/middleware/auth.js
// Middleware untuk autentikasi dan otorisasi (RBAC)
// ============================================================

/**
 * Middleware 1: Cek apakah user sudah login.
 * Jika belum login, redirect ke halaman /login.
 */
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login');
};

/**
 * Middleware 2: Cek apakah role user sesuai.
 * @param {...string} allowedRoles - Role yang boleh mengakses
 * 
 * Contoh penggunaan:
 *   router.get('/dashboard', isAuthenticated, isAuthorized('kader'), handler)
 *   router.get('/bidan',     isAuthenticated, isAuthorized('bidan', 'pj_ptm'), handler)
 */
const isAuthorized = (...allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.session.user?.role;
        if (allowedRoles.includes(userRole)) {
            return next();
        }
        res.status(403).render('partials/404', {
            message: 'Anda tidak memiliki izin untuk mengakses halaman ini.'
        });
    };
};

module.exports = { isAuthenticated, isAuthorized };
