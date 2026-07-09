const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../../src/config/db');
const targetController = require('../../src/controllers/targetController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderKelolaTarget()
// ==============================================================
describe('targetController.renderKelolaTarget()', () => {

    test('happy path → targetGlobal dijumlahkan dari seluruh target per nagari', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_nagari: 1, nama_nagari: 'A' }] }) // nagari aktif
            .mockResolvedValueOnce({ rows: [{ tahun: 2026 }] }) // daftar tahun
            .mockResolvedValueOnce({ rows: [{ id_target: 1, target_total: 500 }, { id_target: 2, target_total: 300 }] }); // target per nagari

        const { req, res } = mockReqRes({ query: {}, session: {} });

        await targetController.renderKelolaTarget(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.targetGlobal).toBe(800);
        expect(data.tahunDipilih).toBe(new Date().getFullYear());
    });

    test('query.tahun diberikan → dipakai sebagai tahunDipilih', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ query: { tahun: '2024' }, session: {} });

        await targetController.renderKelolaTarget(req, res);

        expect(pool.query.mock.calls[2][1]).toEqual([2024]);
    });

    test('flash message dihapus setelah dipakai', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({
            query: {}, session: { successMessage: 'oke', errorMessage: 'gagal' },
        });

        await targetController.renderKelolaTarget(req, res);

        expect(req.session.successMessage).toBeUndefined();
        expect(req.session.errorMessage).toBeUndefined();
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await targetController.renderKelolaTarget(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 2: handleSimpanTargetGlobal()
// ==============================================================
describe('targetController.handleSimpanTargetGlobal()', () => {

    test('tahun/target bukan angka → errorMessage & redirect tanpa query', async () => {
        const { req, res } = mockReqRes({ body: { tahun: 'abc', target_global: 'xyz' }, session: {} });

        await targetController.handleSimpanTargetGlobal(req, res);

        expect(req.session.errorMessage).toMatch(/angka yang valid/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/target');
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('target global <= 0 → errorMessage spesifik', async () => {
        const { req, res } = mockReqRes({ body: { tahun: '2026', target_global: '0' }, session: {} });

        await targetController.handleSimpanTargetGlobal(req, res);

        expect(req.session.errorMessage).toMatch(/lebih dari 0/);
    });

    test('tidak ada nagari aktif → errorMessage & redirect', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ body: { tahun: '2026', target_global: '1000' }, session: {} });

        await targetController.handleSimpanTargetGlobal(req, res);

        expect(req.session.errorMessage).toMatch(/Tidak ada nagari aktif/);
    });

    test('happy path → target dibagi rata, sisa masuk ke nagari pertama', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_nagari: 1 }, { id_nagari: 2 }, { id_nagari: 3 }] }) // 3 nagari aktif
            .mockResolvedValueOnce({}) // upsert nagari 1
            .mockResolvedValueOnce({}) // upsert nagari 2
            .mockResolvedValueOnce({}); // upsert nagari 3

        const { req, res } = mockReqRes({
            body: { tahun: '2026', target_global: '1000', catatan: 'Target awal' },
            session: {},
        });

        await targetController.handleSimpanTargetGlobal(req, res);

        // 1000 / 3 = 333 sisa 1 → nagari pertama dapat 334
        expect(pool.query.mock.calls[1][1]).toEqual([1, 2026, 334, 'Target awal']);
        expect(pool.query.mock.calls[2][1]).toEqual([2, 2026, 333, 'Target awal']);
        expect(req.session.successMessage).toMatch(/berhasil dibagi ke 3 nagari/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/target?tahun=2026');
    });

    test('query gagal → errorMessage sistem & redirect', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ body: { tahun: '2026', target_global: '1000' }, session: {} });

        await targetController.handleSimpanTargetGlobal(req, res);

        expect(req.session.errorMessage).toMatch(/kesalahan sistem/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/target');
    });

});

// ==============================================================
// GRUP 3: handleEditTargetNagari()
// ==============================================================
describe('targetController.handleEditTargetNagari()', () => {

    test('target_total tidak valid (<=0) → errorMessage, redirect dengan tahun', async () => {
        const { req, res } = mockReqRes({ body: { id_target: 1, target_total: '0', tahun: '2026' }, session: {} });

        await targetController.handleEditTargetNagari(req, res);

        expect(req.session.errorMessage).toMatch(/lebih dari 0/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/target?tahun=2026');
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('happy path → update target nagari, successMessage & redirect', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            body: { id_target: 1, target_total: '500', catatan: 'revisi', tahun: '2026' },
            session: {},
        });

        await targetController.handleEditTargetNagari(req, res);

        expect(pool.query).toHaveBeenCalledWith(expect.any(String), [500, 'revisi', 1]);
        expect(req.session.successMessage).toMatch(/berhasil diperbarui/);
    });

    test('query gagal → errorMessage & redirect', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ body: { id_target: 1, target_total: '500', tahun: '2026' }, session: {} });

        await targetController.handleEditTargetNagari(req, res);

        expect(req.session.errorMessage).toMatch(/Gagal memperbarui/);
    });

});

// ==============================================================
// GRUP 4: handleHapusTarget()
// ==============================================================
describe('targetController.handleHapusTarget()', () => {

    test('happy path → hapus semua target tahun tsb, successMessage & redirect', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({ params: { tahun: '2026' }, session: {} });

        await targetController.handleHapusTarget(req, res);

        expect(pool.query).toHaveBeenCalledWith('DELETE FROM target_tahunan WHERE tahun = $1', [2026]);
        expect(req.session.successMessage).toMatch(/2026 berhasil dihapus/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/target');
    });

    test('query gagal → errorMessage & redirect', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { tahun: '2026' }, session: {} });

        await targetController.handleHapusTarget(req, res);

        expect(req.session.errorMessage).toMatch(/Gagal menghapus/);
    });

});

// ==============================================================
// GRUP 5: getTargetByTahun() — helper non-Express (dipanggil langsung)
// ==============================================================
describe('targetController.getTargetByTahun()', () => {

    test('ada data target → mengembalikan total sebagai integer', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ total: '1500' }] });

        const hasil = await targetController.getTargetByTahun(2026);

        expect(hasil).toBe(1500);
    });

    test('belum ada data target (total null) → fallback ke 2000', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ total: null }] });

        const hasil = await targetController.getTargetByTahun(2027);

        expect(hasil).toBe(2000);
    });

});
