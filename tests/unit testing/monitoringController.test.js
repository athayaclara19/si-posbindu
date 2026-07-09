const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../../src/config/db');
const monitoringController = require('../../src/controllers/monitoringController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderMonitoring()
// ==============================================================
describe('monitoringController.renderMonitoring()', () => {

    test('happy path → render bidan/monitoring dengan daftar pasien', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_pasien: '1', nama_pasien: 'Ani' }] });
        const { req, res } = mockReqRes({ session: { user: { role: 'bidan' } } });

        await monitoringController.renderMonitoring(req, res);

        expect(res.render).toHaveBeenCalledWith('bidan/monitoring', expect.objectContaining({
            daftarPasien: [{ id_pasien: '1', nama_pasien: 'Ani' }],
            active: 'monitoring',
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await monitoringController.renderMonitoring(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 2: renderGrafikTensi()
// ==============================================================
describe('monitoringController.renderGrafikTensi()', () => {

    test('happy path → analisa DSS ikut disertakan berdasarkan histori sistole', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_pasien: '1', nama_pasien: 'Ani' }] }) // pasien
            .mockResolvedValueOnce({ rows: [{ sistole: 150, diastole: 95, tanggal_skrining: '2026-01-01' }] }) // riwayat
            .mockResolvedValueOnce({ rows: [] }); // daftar semua pasien

        const { req, res } = mockReqRes({ params: { id_pasien: '1' }, session: {} });

        await monitoringController.renderGrafikTensi(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.pasienTerpilih).toEqual({ id_pasien: '1', nama_pasien: 'Ani' });
        expect(data.analisa.levelBahaya).toBe('Hipertensi Tkt. 1');
    });

    test('pasien tidak ditemukan → pasienTerpilih undefined, tetap tidak crash', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ params: { id_pasien: '999' }, session: {} });

        await monitoringController.renderGrafikTensi(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.pasienTerpilih).toBeUndefined();
        expect(data.analisa.levelBahaya).toBe('Tidak Diketahui');
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id_pasien: '1' }, session: {} });

        await monitoringController.renderGrafikTensi(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 3: getApiTensiPasien()
// ==============================================================
describe('monitoringController.getApiTensiPasien()', () => {

    test('happy path → JSON success dengan data riwayat tensi', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ sistole: 130, diastole: 85 }] });
        const { req, res } = mockReqRes({ params: { id_pasien: '1' } });

        await monitoringController.getApiTensiPasien(req, res);

        expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ sistole: 130, diastole: 85 }] });
    });

    test('query gagal → JSON success:false dengan status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal ambil data'));
        const { req, res } = mockReqRes({ params: { id_pasien: '1' } });

        await monitoringController.getApiTensiPasien(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'gagal ambil data' });
    });

});
