const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../../src/config/db');
const petaController = require('../../src/controllers/petaController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderPetaHipertensi()
// ==============================================================
describe('petaController.renderPetaHipertensi()', () => {

    test('happy path → render halaman peta hipertensi', async () => {
        const { req, res } = mockReqRes({ session: { user: { role: 'kepala_puskesmas' } } });

        await petaController.renderPetaHipertensi(req, res);

        expect(res.render).toHaveBeenCalledWith('kepala/peta_hipertensi', expect.objectContaining({
            active: 'peta-hipertensi',
        }));
    });

    test('tanpa session.user → role default "kepala_puskesmas"', async () => {
        const { req, res } = mockReqRes({ session: {} });

        await petaController.renderPetaHipertensi(req, res);

        expect(res.render).toHaveBeenCalledWith('kepala/peta_hipertensi', expect.objectContaining({
            currentUser: null,
            role: 'kepala_puskesmas',
        }));
    });

});

// ==============================================================
// GRUP 2: getDataPetaHipertensi()
// ==============================================================
describe('petaController.getDataPetaHipertensi()', () => {

    test('dengan filter bulan & tahun → query pakai EXTRACT bulan/tahun', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{ nama_nagari: 'Koto Tuo', total_pasien: '10', total_hipertensi: '4' }],
        });
        const { req, res } = mockReqRes({ query: { bulan: '5', tahun: '2026' } });

        await petaController.getDataPetaHipertensi(req, res);

        expect(pool.query.mock.calls[0][1]).toEqual([5, 2026]);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: [{ nama_nagari: 'Koto Tuo', total_pasien: 10, total_hipertensi: 4, persen_hipertensi: 40 }],
        });
    });

    test('filter bulan/tahun tanpa hasil → data array kosong', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ query: { bulan: '5', tahun: '2026' } });

        await petaController.getDataPetaHipertensi(req, res);

        expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    test('tanpa filter → pakai query semua data terverifikasi', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{ nama_nagari: 'Balingka', total_pasien: '0', total_hipertensi: '0' }],
        });
        const { req, res } = mockReqRes({ query: {} });

        await petaController.getDataPetaHipertensi(req, res);

        expect(pool.query.mock.calls[0][0]).not.toContain('EXTRACT(MONTH');
        const payload = res.json.mock.calls[0][0];
        expect(payload.data[0].persen_hipertensi).toBe(0); // hindari pembagian oleh nol
    });

    test('query gagal → status 500 JSON error', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal query peta'));
        const { req, res } = mockReqRes({ query: {} });

        await petaController.getDataPetaHipertensi(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'gagal query peta' });
    });

});
