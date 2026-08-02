const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../../src/config/db');
const ptmController = require('../../src/controllers/ptmController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderKelolaPasien()
// ==============================================================
describe('ptmController.renderKelolaPasien()', () => {

    function setupHappyPath() {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '1' }] })
            .mockResolvedValueOnce({ rows: [{ id_pasien: 'P1' }] })
            .mockResolvedValueOnce({ rows: [{ id_nagari: 1 }] })
            .mockResolvedValueOnce({ rows: [{ id_jorong: 1 }] });
    }

    test('happy path → render ptm/kelolapasien dengan pagination default', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await ptmController.renderKelolaPasien(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/kelolapasien', expect.objectContaining({
            page: 1, totalData: 1,
        }));
    });

    test('flash message dihapus setelah dipakai', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({
            query: {}, session: { successMessage: 'sukses', errorMessage: 'error' },
        });

        await ptmController.renderKelolaPasien(req, res);

        expect(req.session.successMessage).toBeUndefined();
        expect(req.session.errorMessage).toBeUndefined();
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await ptmController.renderKelolaPasien(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 2: renderEditPasien()
// ==============================================================
describe('ptmController.renderEditPasien()', () => {

    test('pasien ditemukan → render form edit', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_pasien: 'P1', nama_pasien: 'Ani' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ params: { id: 'P1' }, session: {} });

        await ptmController.renderEditPasien(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/edit_pasien', expect.objectContaining({
            pasien: { id_pasien: 'P1', nama_pasien: 'Ani' },
        }));
    });

    test('pasien tidak ditemukan → 404', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ params: { id: 'X' }, session: {} });

        await ptmController.renderEditPasien(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id: 'P1' }, session: {} });

        await ptmController.renderEditPasien(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 3: handleUpdatePasien()
// ==============================================================
describe('ptmController.handleUpdatePasien()', () => {

    test('happy path → tahun_lahir dihitung ulang & redirect ke /ptm/pasien', async () => {
        pool.query.mockResolvedValueOnce({});
        const tahunSekarang = new Date().getFullYear();

        const { req, res } = mockReqRes({
            body: {
                id_pasien: 'P1', nik: '123', nama_pasien: 'Ani', usia: '35',
                jenis_kelamin: 'Perempuan', id_jorong: 2, alamat: 'Jl. B',
                no_hp: '0812', pekerjaan: 'PNS', agama: 'Islam',
            },
        });

        await ptmController.handleUpdatePasien(req, res);

        const values = pool.query.mock.calls[0][1];
        expect(values[3]).toBe(tahunSekarang - 35);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/pasien');
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ body: { id_pasien: 'P1', usia: '20' } });

        await ptmController.handleUpdatePasien(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 4: handleDeletePasien()
// ==============================================================
describe('ptmController.handleDeletePasien()', () => {

    test('happy path → hapus skrining lalu pasien, set successMessage, redirect', async () => {
        pool.query.mockResolvedValueOnce({}).mockResolvedValueOnce({});
        const { req, res } = mockReqRes({ params: { id: 'P1' }, session: {} });

        await ptmController.handleDeletePasien(req, res);

        expect(pool.query).toHaveBeenNthCalledWith(1, 'DELETE FROM skrining WHERE id_pasien = $1', ['P1']);
        expect(pool.query).toHaveBeenNthCalledWith(2, 'DELETE FROM pasien WHERE id_pasien = $1', ['P1']);
        expect(req.session.successMessage).toMatch(/berhasil dihapus/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/pasien');
    });

    test('query gagal → set errorMessage, tetap redirect (tidak crash)', async () => {
        pool.query.mockRejectedValueOnce(new Error('constraint terkait data lain'));
        const { req, res } = mockReqRes({ params: { id: 'P1' }, session: {} });

        await ptmController.handleDeletePasien(req, res);

        expect(req.session.errorMessage).toMatch(/Gagal menghapus/);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/pasien');
    });

});

// ==============================================================
// GRUP 5: renderDashboardPTM()
// ==============================================================
describe('ptmController.renderDashboardPTM()', () => {

    function setupHappyPath({ target = 2000 } = {}) {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_jenis_ptm: 'hipertensi', nama_ptm: 'Hipertensi' }] }) // list PTM
            .mockResolvedValueOnce({ rows: [{ nama_ptm: 'Hipertensi' }] }) // active PTM
            .mockResolvedValueOnce({ rows: target !== null ? [{ target_total: target }] : [] }) // target tahunan sum
            .mockResolvedValueOnce({ rows: [{ total_tercapai: '500' }] }) // capaian
            .mockResolvedValueOnce({ rows: [{ abnormal_cases: '200', normal_cases: '300' }] }) // metrik
            .mockResolvedValueOnce({ rows: [{ nama_nagari: 'Koto Tuo', capaian: '100', target_total: '50' }] }) // per nagari
            .mockResolvedValueOnce({ rows: [{ total: 10, hipertensi: 2, dm: 2, obesitas: 2, ppok: 2, gangguan_indra: 1, kesehatan_jiwa: 1 }] }); // ptmStats
    }

    test('happy path → persentase target & hipertensi dihitung dengan benar', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ session: {} });

        await ptmController.renderDashboardPTM(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.TARGET_TAHUNAN).toBe(2000);
        expect(data.totalTercapai).toBe(500);
        expect(data.sisaTarget).toBe(1500);
        expect(data.persenTarget).toBe(25);
        expect(data.persenHipertensi).toBe('40.0'); // 200/500
        expect(data.persenTerkendali).toBe('60.0'); // 300/500
    });

    test('target belum diset di DB → fallback ke 2000', async () => {
        setupHappyPath({ target: null });
        const { req, res } = mockReqRes({ session: {} });

        await ptmController.renderDashboardPTM(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.TARGET_TAHUNAN).toBe(2000);
    });

    test('distribusi target per nagari proporsional terhadap jumlah pasien', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_jenis_ptm: 'hipertensi', nama_ptm: 'Hipertensi' }] }) // list PTM
            .mockResolvedValueOnce({ rows: [{ nama_ptm: 'Hipertensi' }] }) // active PTM
            .mockResolvedValueOnce({ rows: [{ target_total: 1000 }] })
            .mockResolvedValueOnce({ rows: [{ total_tercapai: '0' }] })
            .mockResolvedValueOnce({ rows: [{ abnormal_cases: '0', normal_cases: '0' }] })
            .mockResolvedValueOnce({ rows: [
                { nama_nagari: 'A', capaian: '0', target_total: '800' },
                { nama_nagari: 'B', capaian: '0', target_total: '200' },
            ] })
            .mockResolvedValueOnce({ rows: [{ total: 10, hipertensi: 2, dm: 2, obesitas: 2, ppok: 2, gangguan_indra: 1, kesehatan_jiwa: 1 }] });

        const { req, res } = mockReqRes({ session: {} });

        await ptmController.renderDashboardPTM(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.dataNagari[0].target).toBe(800);
        expect(data.dataNagari[1].target).toBe(200);
    });

    test('totalTercapai 0 → persenHipertensi/persenTerkendali 0 (bukan NaN)', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_jenis_ptm: 'hipertensi', nama_ptm: 'Hipertensi' }] }) // list PTM
            .mockResolvedValueOnce({ rows: [{ nama_ptm: 'Hipertensi' }] }) // active PTM
            .mockResolvedValueOnce({ rows: [{ target_total: 2000 }] })
            .mockResolvedValueOnce({ rows: [{ total_tercapai: '0' }] })
            .mockResolvedValueOnce({ rows: [{ abnormal_cases: '0', normal_cases: '0' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ total: 0, hipertensi: 0, dm: 0, obesitas: 0, ppok: 0, gangguan_indra: 0, kesehatan_jiwa: 0 }] });

        const { req, res } = mockReqRes({ session: {} });

        await ptmController.renderDashboardPTM(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.persenHipertensi).toBe(0);
        expect(data.persenTerkendali).toBe(0);
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await ptmController.renderDashboardPTM(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});
