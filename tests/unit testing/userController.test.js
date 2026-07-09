const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

const pool   = require('../../src/config/db');
const bcrypt = require('bcryptjs');
const userController = require('../../src/controllers/userController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderKelolaUser()
// ==============================================================
describe('userController.renderKelolaUser()', () => {

    test('happy path → render ptm/kelolauser dengan daftar user', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_user: 1, nama_user: 'Budi' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ session: {} });

        await userController.renderKelolaUser(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/kelolauser', expect.objectContaining({
            users: [{ id_user: 1, nama_user: 'Budi' }],
        }));
    });

    test('flash message dihapus setelah dipakai', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ session: { successMessage: 'a', errorMessage: 'b' } });

        await userController.renderKelolaUser(req, res);

        expect(req.session.successMessage).toBeUndefined();
        expect(req.session.errorMessage).toBeUndefined();
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await userController.renderKelolaUser(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 2: handleTambahUser()
// ==============================================================
describe('userController.handleTambahUser()', () => {

    test('username sudah dipakai → errorMessage, redirect tanpa insert', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_user: 9 }] });
        const { req, res } = mockReqRes({
            body: { nama_user: 'Ani', username: 'ani123', password: 'rahasia', role: 'kader' },
            session: {},
        });

        await userController.handleTambahUser(req, res);

        expect(req.session.errorMessage).toMatch(/sudah digunakan/);
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/user');
    });

    test('happy path → password di-hash, user diinsert, successMessage', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] }) // cek username kosong
            .mockResolvedValueOnce({}); // insert
        bcrypt.hash.mockResolvedValueOnce('hashed123');

        const { req, res } = mockReqRes({
            body: { nama_user: 'Budi', username: 'budi', password: 'rahasia', role: 'bidan', id_jorong: '' },
            session: {},
        });

        await userController.handleTambahUser(req, res);

        expect(bcrypt.hash).toHaveBeenCalledWith('rahasia', 10);
        expect(pool.query.mock.calls[1][1]).toEqual(['Budi', 'budi', 'hashed123', 'bidan', null]);
        expect(req.session.successMessage).toMatch(/berhasil ditambahkan/);
    });

    test('id_jorong diisi → dipakai apa adanya (bukan null)', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({});
        bcrypt.hash.mockResolvedValueOnce('hashed');

        const { req, res } = mockReqRes({
            body: { nama_user: 'Cici', username: 'cici', password: 'x', role: 'kader', id_jorong: '4' },
            session: {},
        });

        await userController.handleTambahUser(req, res);

        expect(pool.query.mock.calls[1][1]).toEqual(['Cici', 'cici', 'hashed', 'kader', '4']);
    });

    test('query gagal → errorMessage sistem & redirect', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ body: { nama_user: 'X', username: 'x', password: 'y', role: 'kader' }, session: {} });

        await userController.handleTambahUser(req, res);

        expect(req.session.errorMessage).toMatch(/kesalahan sistem/);
    });

});

// ==============================================================
// GRUP 3: renderEditUser()
// ==============================================================
describe('userController.renderEditUser()', () => {

    test('user ditemukan (bukan diri sendiri) → render form edit', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_user: 2, nama_user: 'Budi' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ params: { id: 2 }, session: { user: { id_user: 1 } } });

        await userController.renderEditUser(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/edituser', expect.objectContaining({
            editUser: { id_user: 2, nama_user: 'Budi' },
        }));
    });

    test('user tidak ditemukan → 404', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ params: { id: 999 }, session: { user: { id_user: 1 } } });

        await userController.renderEditUser(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('mencoba edit akun sendiri → errorMessage & redirect ke /ptm/user', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_user: 1, nama_user: 'Diri Sendiri' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ params: { id: 1 }, session: { user: { id_user: 1 } } });

        await userController.renderEditUser(req, res);

        expect(req.session.errorMessage).toMatch(/menu Profil/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/user');
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id: 2 }, session: { user: { id_user: 1 } } });

        await userController.renderEditUser(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 4: handleUpdateUser()
// ==============================================================
describe('userController.handleUpdateUser()', () => {

    test('username dipakai user lain → errorMessage, redirect ke form edit', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_user: 3 }] });
        const { req, res } = mockReqRes({
            body: { id_user: 2, nama_user: 'Budi', username: 'dipakai', role: 'kader' },
            session: {},
        });

        await userController.handleUpdateUser(req, res);

        expect(req.session.errorMessage).toMatch(/sudah digunakan user lain/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/user/edit/2');
    });

    test('happy path → update data user, successMessage & redirect ke /ptm/user', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            body: { id_user: 2, nama_user: 'Budi Baru', username: 'budi2', role: 'bidan', id_jorong: '3' },
            session: {},
        });

        await userController.handleUpdateUser(req, res);

        expect(pool.query.mock.calls[1][1]).toEqual(['Budi Baru', 'budi2', 'bidan', '3', 2]);
        expect(req.session.successMessage).toMatch(/berhasil diperbarui/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/user');
    });

    test('query gagal → errorMessage & redirect', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ body: { id_user: 2, username: 'x', role: 'kader' }, session: {} });

        await userController.handleUpdateUser(req, res);

        expect(req.session.errorMessage).toMatch(/Gagal memperbarui/);
    });

});

// ==============================================================
// GRUP 5: handleToggleAktif()
// ==============================================================
describe('userController.handleToggleAktif()', () => {

    test('mencoba nonaktifkan akun sendiri → errorMessage & redirect tanpa query', async () => {
        const { req, res } = mockReqRes({ params: { id: 1 }, session: { user: { id_user: 1 } } });

        await userController.handleToggleAktif(req, res);

        expect(req.session.errorMessage).toMatch(/tidak dapat menonaktifkan akun Anda sendiri/);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('toggle user lain → successMessage sesuai status baru (nonaktif)', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ nama_user: 'Budi', is_active: false }] });
        const { req, res } = mockReqRes({ params: { id: 2 }, session: { user: { id_user: 1 } } });

        await userController.handleToggleAktif(req, res);

        expect(req.session.successMessage).toMatch(/dinonaktifkan/);
    });

    test('toggle user lain → successMessage sesuai status baru (aktif)', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ nama_user: 'Budi', is_active: true }] });
        const { req, res } = mockReqRes({ params: { id: 2 }, session: { user: { id_user: 1 } } });

        await userController.handleToggleAktif(req, res);

        expect(req.session.successMessage).toMatch(/diaktifkan/);
    });

    test('query gagal → errorMessage & redirect', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id: 2 }, session: { user: { id_user: 1 } } });

        await userController.handleToggleAktif(req, res);

        expect(req.session.errorMessage).toMatch(/Gagal mengubah status/);
    });

});

// ==============================================================
// GRUP 6: handleResetPassword()
// ==============================================================
describe('userController.handleResetPassword()', () => {

    test('password baru kurang dari 6 karakter → errorMessage, redirect tanpa proses', async () => {
        const { req, res } = mockReqRes({ params: { id: 2 }, body: { password_baru: '123' }, session: {} });

        await userController.handleResetPassword(req, res);

        expect(req.session.errorMessage).toMatch(/minimal 6 karakter/);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('happy path → password di-hash & disimpan, successMessage', async () => {
        bcrypt.hash.mockResolvedValueOnce('hashedbaru');
        pool.query.mockResolvedValueOnce({ rows: [{ nama_user: 'Budi' }] });

        const { req, res } = mockReqRes({ params: { id: 2 }, body: { password_baru: 'rahasia123' }, session: {} });

        await userController.handleResetPassword(req, res);

        expect(bcrypt.hash).toHaveBeenCalledWith('rahasia123', 10);
        expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['hashedbaru', 2]);
        expect(req.session.successMessage).toMatch(/berhasil direset/);
    });

    test('query gagal → errorMessage & redirect', async () => {
        bcrypt.hash.mockResolvedValueOnce('hashed');
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id: 2 }, body: { password_baru: 'rahasia123' }, session: {} });

        await userController.handleResetPassword(req, res);

        expect(req.session.errorMessage).toMatch(/Gagal mereset password/);
    });

});

// ==============================================================
// GRUP 7: handleUpdateProfilSendiri()
// ==============================================================
describe('userController.handleUpdateProfilSendiri()', () => {

    test('nama_user kosong → errorMessage, redirect ke halaman role masing-masing', async () => {
        const { req, res } = mockReqRes({
            body: { nama_user: '  ', username: 'budi' },
            session: { user: { id_user: 1, role: 'bidan' } },
        });

        await userController.handleUpdateProfilSendiri(req, res);

        expect(req.session.errorMessage).toMatch(/Nama lengkap tidak boleh kosong/);
        expect(res.redirect).toHaveBeenCalledWith('/bidan');
    });

    test('username kosong → errorMessage', async () => {
        const { req, res } = mockReqRes({
            body: { nama_user: 'Budi', username: '   ' },
            session: { user: { id_user: 1, role: 'kader' } },
        });

        await userController.handleUpdateProfilSendiri(req, res);

        expect(req.session.errorMessage).toMatch(/Username tidak boleh kosong/);
        expect(res.redirect).toHaveBeenCalledWith('/');
    });

    test('username dipakai user lain → errorMessage', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_user: 9 }] });
        const { req, res } = mockReqRes({
            body: { nama_user: 'Budi', username: 'dipakai' },
            session: { user: { id_user: 1, role: 'pj_ptm' } },
        });

        await userController.handleUpdateProfilSendiri(req, res);

        expect(req.session.errorMessage).toMatch(/sudah digunakan user lain/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm');
    });

    test('happy path → profil diperbarui & session ikut disinkronkan', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            body: { nama_user: '  Budi Baru  ', username: '  budi_baru  ' },
            session: { user: { id_user: 1, role: 'kepala_puskesmas', nama: 'Budi Lama', username: 'budi_lama' } },
        });

        await userController.handleUpdateProfilSendiri(req, res);

        expect(req.session.user.nama).toBe('Budi Baru');
        expect(req.session.user.username).toBe('budi_baru');
        expect(req.session.successMessage).toMatch(/berhasil diperbarui/);
        expect(res.redirect).toHaveBeenCalledWith('/kepala');
    });

    test('query gagal → errorMessage sistem & redirect ke halaman role', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({
            body: { nama_user: 'Budi', username: 'budi' },
            session: { user: { id_user: 1, role: 'kader' } },
        });

        await userController.handleUpdateProfilSendiri(req, res);

        expect(req.session.errorMessage).toMatch(/kesalahan sistem/);
        expect(res.redirect).toHaveBeenCalledWith('/');
    });

});
