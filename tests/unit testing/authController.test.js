const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

const pool   = require('../../src/config/db');
const bcrypt = require('bcryptjs');
const authController = require('../../src/controllers/authController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderLogin()
// ==============================================================
describe('authController.renderLogin()', () => {

    test('belum login (session.user kosong) → render halaman login tanpa error', () => {
        const { req, res } = mockReqRes({ session: {} });
        authController.renderLogin(req, res);
        expect(res.render).toHaveBeenCalledWith('login', { error: null });
        expect(res.redirect).not.toHaveBeenCalled();
    });

    test('sudah login role kader → redirect ke "/"', () => {
        const { req, res } = mockReqRes({ session: { user: { role: 'kader' } } });
        authController.renderLogin(req, res);
        expect(res.redirect).toHaveBeenCalledWith('/');
    });

    test('sudah login role bidan → redirect ke "/bidan"', () => {
        const { req, res } = mockReqRes({ session: { user: { role: 'bidan' } } });
        authController.renderLogin(req, res);
        expect(res.redirect).toHaveBeenCalledWith('/bidan');
    });

    test('sudah login role pj_ptm → redirect ke "/ptm"', () => {
        const { req, res } = mockReqRes({ session: { user: { role: 'pj_ptm' } } });
        authController.renderLogin(req, res);
        expect(res.redirect).toHaveBeenCalledWith('/ptm');
    });

    test('sudah login role kepala_puskesmas → redirect ke "/kepala"', () => {
        const { req, res } = mockReqRes({ session: { user: { role: 'kepala_puskesmas' } } });
        authController.renderLogin(req, res);
        expect(res.redirect).toHaveBeenCalledWith('/kepala');
    });

    test('role tidak dikenal → fallback redirect ke "/login"', () => {
        const { req, res } = mockReqRes({ session: { user: { role: 'entah_apa' } } });
        authController.renderLogin(req, res);
        expect(res.redirect).toHaveBeenCalledWith('/login');
    });

});

// ==============================================================
// GRUP 2: handleLogin()
// ==============================================================
describe('authController.handleLogin()', () => {

    test('username tidak ditemukan → render login dengan pesan error', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ body: { email: 'tidakada', password: 'x' }, session: {} });

        await authController.handleLogin(req, res);

        expect(res.render).toHaveBeenCalledWith('login', { error: 'Username atau Password salah.' });
    });

    test('password salah → render login dengan pesan error yang sama', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_user: 1, password: 'hashed', role: 'kader' }] });
        bcrypt.compare.mockResolvedValueOnce(false);
        const { req, res } = mockReqRes({ body: { email: 'kader1', password: 'salah' }, session: {} });

        await authController.handleLogin(req, res);

        expect(res.render).toHaveBeenCalledWith('login', { error: 'Username atau Password salah.' });
    });

    test('login berhasil (role kader) → session.user terisi & redirect ke "/"', async () => {
        const userDb = {
            id_user: 5, nama_user: 'Budi', username: 'budi', password: 'hashed',
            role: 'kader', id_jorong: 2,
        };
        pool.query.mockResolvedValueOnce({ rows: [userDb] });
        bcrypt.compare.mockResolvedValueOnce(true);
        const { req, res } = mockReqRes({ body: { email: 'budi', password: 'benar' }, session: {} });

        await authController.handleLogin(req, res);

        expect(req.session.user).toEqual({
            id_user: 5, nama: 'Budi', username: 'budi', role: 'kader', id_jorong: 2,
        });
        expect(res.redirect).toHaveBeenCalledWith('/');
    });

    test('login berhasil role pj_ptm → redirect ke "/ptm"', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_user: 1, password: 'h', role: 'pj_ptm' }] });
        bcrypt.compare.mockResolvedValueOnce(true);
        const { req, res } = mockReqRes({ body: { email: 'ptm1', password: 'benar' }, session: {} });

        await authController.handleLogin(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm');
    });

    test('role tidak dikenal setelah login berhasil → fallback redirect "/login"', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_user: 1, password: 'h', role: 'entah' }] });
        bcrypt.compare.mockResolvedValueOnce(true);
        const { req, res } = mockReqRes({ body: { email: 'x', password: 'benar' }, session: {} });

        await authController.handleLogin(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/login');
    });

    test('query DB gagal (reject) → render login dengan pesan kesalahan server', async () => {
        pool.query.mockRejectedValueOnce(new Error('DB down'));
        const { req, res } = mockReqRes({ body: { email: 'x', password: 'y' }, session: {} });

        await authController.handleLogin(req, res);

        expect(res.render).toHaveBeenCalledWith('login', { error: 'Terjadi kesalahan pada server.' });
    });

});

// ==============================================================
// GRUP 3: handleLogout()
// ==============================================================
describe('authController.handleLogout()', () => {

    test('logout sukses → redirect ke "/login"', () => {
        const { req, res } = mockReqRes({
            session: { destroy: jest.fn((cb) => cb(null)) },
        });

        authController.handleLogout(req, res);

        expect(req.session.destroy).toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/login');
    });

    test('session.destroy error → tetap redirect ke "/login" (tidak crash)', () => {
        const { req, res } = mockReqRes({
            session: { destroy: jest.fn((cb) => cb(new Error('gagal destroy'))) },
        });

        authController.handleLogout(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/login');
    });

});
