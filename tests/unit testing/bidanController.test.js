const { mockReqRes, buatWorkbookMock } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('exceljs', () => ({ Workbook: jest.fn() }));

const pool    = require('../../src/config/db');
const ExcelJS = require('exceljs');
const bidanController = require('../../src/controllers/bidanController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderDashboard()
// ==============================================================
describe('bidanController.renderDashboard()', () => {

    function setupHappyPath() {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '3' }] })   // menunggu
            .mockResolvedValueOnce({ rows: [{ count: '5' }] })   // terverifikasi
            .mockResolvedValueOnce({ rows: [{ count: '2' }] })   // ditolak/revisi
            .mockResolvedValueOnce({ rows: [{ id_skrining: 1 }] }) // antrean
            .mockResolvedValueOnce({ rows: [{ nama_jorong: 'A' }] }) // jorongStats
            .mockResolvedValueOnce({ rows: [{ normal: '1' }] });    // tensiStats
    }

    test('happy path → total data dijumlahkan dengan benar & render dashboard', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ session: { user: { id_user: 1, role: 'bidan' } } });

        await bidanController.renderDashboard(req, res);

        expect(res.render).toHaveBeenCalledWith('bidan/dashboardbidan', expect.objectContaining({
            jumlahMenunggu: 3,
            jumlahTerverifikasi: 5,
            jumlahDitolak: 2,
            totalData: 10,
        }));
    });

    test('tanpa session.user → role default "bidan" & currentUser null', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ session: {} });

        await bidanController.renderDashboard(req, res);

        expect(res.render).toHaveBeenCalledWith('bidan/dashboardbidan', expect.objectContaining({
            currentUser: null,
            role: 'bidan',
        }));
    });

    test('flash message dihapus dari session setelah dipakai', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({
            session: { user: { id_user: 1 }, successMessage: 'Berhasil!', errorMessage: 'Ada error' },
        });

        await bidanController.renderDashboard(req, res);

        expect(req.session.successMessage).toBeUndefined();
        expect(req.session.errorMessage).toBeUndefined();
    });

    test('query DB gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('DB error'));
        const { req, res } = mockReqRes({ session: {} });

        await bidanController.renderDashboard(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith('Gagal memuat dashboard bidan.');
    });

});

// ==============================================================
// GRUP 2: renderValidasi()
// ==============================================================
describe('bidanController.renderValidasi()', () => {

    test('happy path → render bidan/validasi dengan daftar antrean', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_skrining: 1 }, { id_skrining: 2 }] });
        const { req, res } = mockReqRes({ session: { user: { role: 'bidan' } } });

        await bidanController.renderValidasi(req, res);

        expect(res.render).toHaveBeenCalledWith('bidan/validasi', expect.objectContaining({
            menungguValidasi: [{ id_skrining: 1 }, { id_skrining: 2 }],
            active: 'validasi',
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await bidanController.renderValidasi(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 3: handleActionValidasi()
// ==============================================================
describe('bidanController.handleActionValidasi()', () => {

    test('status "terverifikasi" → disimpan sebagai "terverifikasi" & redirect', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            params: { id_skrining: 10 },
            body: { status_validasi: 'terverifikasi', catatan_bidan: '' },
            session: { user: { id_user: 7 } },
        });

        await bidanController.handleActionValidasi(req, res);

        expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['terverifikasi', null, 7, 10]);
        expect(res.redirect).toHaveBeenCalledWith('/bidan/validasi');
    });

    test('status "Valid" (alias) → tetap disimpan sebagai "terverifikasi"', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            params: { id_skrining: 11 },
            body: { status_validasi: 'Valid' },
            session: { user: { id_user: 7 } },
        });

        await bidanController.handleActionValidasi(req, res);

        expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['terverifikasi', null, 7, 11]);
    });

    test('status "ditolak" (alias) → disimpan sebagai "revisi"', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            params: { id_skrining: 12 },
            body: { status_validasi: 'ditolak', catatan_bidan: 'Data kurang lengkap' },
            session: { user: { id_user: 7 } },
        });

        await bidanController.handleActionValidasi(req, res);

        expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['revisi', 'Data kurang lengkap', 7, 12]);
    });

    test('status tidak valid → status 400', async () => {
        const { req, res } = mockReqRes({
            params: { id_skrining: 13 },
            body: { status_validasi: 'status_ngasal' },
            session: { user: { id_user: 7 } },
        });

        await bidanController.handleActionValidasi(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('session.user tidak ada → id_validator null (tidak crash)', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            params: { id_skrining: 14 },
            body: { status_validasi: 'revisi' },
            session: {},
        });

        await bidanController.handleActionValidasi(req, res);

        expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['revisi', null, null, 14]);
    });

    test('query gagal → status 500 dengan pesan error', async () => {
        pool.query.mockRejectedValueOnce(new Error('constraint violation'));
        const { req, res } = mockReqRes({
            params: { id_skrining: 15 },
            body: { status_validasi: 'terverifikasi' },
            session: { user: { id_user: 1 } },
        });

        await bidanController.handleActionValidasi(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('constraint violation'));
    });

});

// ==============================================================
// GRUP 4: renderLaporan()
// ==============================================================
describe('bidanController.renderLaporan()', () => {

    function setupHappyPath() {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // countResult
            .mockResolvedValueOnce({ rows: [{ id_skrining: 1 }] }) // data
            .mockResolvedValueOnce({ rows: [{ id_jorong: 1, nama_jorong: 'A' }] }); // jorong dropdown
    }

    test('tanpa filter apapun → whereClause default hanya status terverifikasi', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await bidanController.renderLaporan(req, res);

        const countCall = pool.query.mock.calls[0];
        expect(countCall[0]).toContain("s.status_validasi = 'terverifikasi'");
        expect(countCall[1]).toEqual([]);
        expect(res.render).toHaveBeenCalledWith('bidan/laporan', expect.objectContaining({
            page: 1, totalData: 2, totalPages: 1,
        }));
    });

    test('dengan search & filter jorong & status → parameter query dibangun sesuai urutan', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({
            query: { search: 'Budi', jorong: '3', status: 'ht1', page: '2' },
            session: {},
        });

        await bidanController.renderLaporan(req, res);

        const countCall = pool.query.mock.calls[0];
        expect(countCall[1]).toEqual(['%Budi%', '3']);
        expect(countCall[0]).toContain('s.sistole >= 140 AND s.sistole < 160');
    });

    test('status filter tidak dikenal → tidak menambah kondisi bucket', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ query: { status: 'bukan_valid' }, session: {} });

        await bidanController.renderLaporan(req, res);

        const countCall = pool.query.mock.calls[0];
        expect(countCall[0]).not.toContain('s.sistole');
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal query'));
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await bidanController.renderLaporan(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 5: exportLaporanExcel()
// ==============================================================
describe('bidanController.exportLaporanExcel()', () => {

    test('happy path → header Excel & filename diset, workbook ditulis ke response', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{
                nama_pasien: 'Siti', nik: '123', nama_jorong: 'A',
                tanggal_kegiatan: '2026-01-05', sistole: 150, diastole: 95,
                berat_badan: 60, tinggi_badan: 160, gula_darah: 100,
            }],
        });
        const wbMock = buatWorkbookMock();
        ExcelJS.Workbook.mockImplementation(() => wbMock);
        const { req, res } = mockReqRes({});

        await bidanController.exportLaporanExcel(req, res);

        expect(res.headers['Content-Type']).toContain('spreadsheetml');
        expect(res.headers['Content-Disposition']).toContain('Laporan_Posbindu.xlsx');
        expect(res.ended).toBe(true);
    });

    test('query gagal → status 500 dengan pesan error', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal ambil data'));
        const { req, res } = mockReqRes({});

        await bidanController.exportLaporanExcel(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('gagal ambil data'));
    });

});
