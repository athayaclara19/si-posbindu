const { mockReqRes, buatWorkbookMock } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('exceljs', () => ({ Workbook: jest.fn() }));

const pool    = require('../../src/config/db');
const ExcelJS = require('exceljs');
const laporanController = require('../../src/controllers/laporanController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: getPreviewData()
// ==============================================================
describe('laporanController.getPreviewData()', () => {

    test('periode belum ada di DB → JSON kosong dengan narasi 0 data', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ query: { bulan: '5', tahun: '2026' } });

        await laporanController.getPreviewData(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            total_pasien: 0, total_skrining: 0, total_hipertensi: 0, per_nagari: [],
        }));
    });

    test('periode ada & ada data → agregat & narasi dihitung dengan benar', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ periode_id: 1 }] }) // periode ditemukan
            .mockResolvedValueOnce({ rows: [{ total_pasien: '10', total_skrining: '20', total_hipertensi: '4' }] }) // agg
            .mockResolvedValueOnce({ rows: [{ nama_nagari: 'Koto Tuo', total_pasien: '5' }] }); // per nagari

        const { req, res } = mockReqRes({ query: { bulan: '6', tahun: '2026' } });

        await laporanController.getPreviewData(req, res);

        const payload = res.json.mock.calls[0][0];
        expect(payload.total_pasien).toBe(10);
        expect(payload.total_skrining).toBe(20);
        expect(payload.narasi).toMatch(/Juni 2026/);
        expect(payload.narasi).toMatch(/2\.00 kali/); // rata-rata 20/10
    });

    test('query gagal → status 500 JSON error', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal query'));
        const { req, res } = mockReqRes({ query: { bulan: '1', tahun: '2026' } });

        await laporanController.getPreviewData(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'gagal query' });
    });

});

// ==============================================================
// GRUP 2: generateLaporan()
// ==============================================================
describe('laporanController.generateLaporan()', () => {

    test('periode masa depan → redirect error=periode_masa_depan tanpa query DB', async () => {
        const tahunDepan = new Date().getFullYear() + 1;
        const { req, res } = mockReqRes({
            body: { periode_bulan: '1', periode_tahun: String(tahunDepan) },
            session: { user: { id_user: 1 } },
        });

        await laporanController.generateLaporan(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/rekap?error=periode_masa_depan');
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('periode sudah ada → langsung agregat & upsert laporan, redirect sukses', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ periode_id: 2 }] }) // periode ditemukan
            .mockResolvedValueOnce({ rows: [{ total_pasien: 5, total_skrining: 8, total_hipertensi: 2 }] }) // agg
            .mockResolvedValueOnce({ rows: [{ id_laporan: 77 }] }); // insert laporan

        const { req, res } = mockReqRes({
            body: { periode_bulan: '1', periode_tahun: '2025' },
            session: { user: { id_user: 1 } },
        });

        await laporanController.generateLaporan(req, res);

        expect(pool.query).toHaveBeenCalledTimes(3);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/laporan?generated=77');
    });

    test('periode belum ada → dibuat dulu sebelum agregat', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] }) // periode belum ada
            .mockResolvedValueOnce({ rows: [{ periode_id: 9 }] }) // insert periode
            .mockResolvedValueOnce({ rows: [{ total_pasien: 0, total_skrining: 0, total_hipertensi: 0 }] }) // agg
            .mockResolvedValueOnce({ rows: [{ id_laporan: 1 }] }); // insert laporan

        const { req, res } = mockReqRes({
            body: { periode_bulan: '2', periode_tahun: '2025' },
            session: { user: { id_user: 1 } },
        });

        await laporanController.generateLaporan(req, res);

        expect(pool.query).toHaveBeenCalledTimes(4);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/laporan?generated=1');
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({
            body: { periode_bulan: '1', periode_tahun: '2025' },
            session: { user: { id_user: 1 } },
        });

        await laporanController.generateLaporan(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 3: kirimLaporan()
// ==============================================================
describe('laporanController.kirimLaporan()', () => {

    test('laporan berstatus draft → berhasil dikirim, redirect ke /ptm/laporan', async () => {
        pool.query.mockResolvedValueOnce({ rowCount: 1 });
        const { req, res } = mockReqRes({ params: { id_laporan: 5 } });

        await laporanController.kirimLaporan(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/laporan');
    });

    test('laporan bukan draft (rowCount 0) → redirect dengan pesan error', async () => {
        pool.query.mockResolvedValueOnce({ rowCount: 0 });
        const { req, res } = mockReqRes({ params: { id_laporan: 5 } });

        await laporanController.kirimLaporan(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/laporan?error=laporan_sudah_dikirim');
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id_laporan: 5 } });

        await laporanController.kirimLaporan(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 4: exportExcelKohort()
// ==============================================================
describe('laporanController.exportExcelKohort()', () => {

    test('laporan tidak ditemukan → 404', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ params: { id_laporan: 999 } });

        await laporanController.exportExcelKohort(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('laporan ditemukan → header Excel diset & file ditulis', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_laporan: 1, periode_bulan: 6, periode_tahun: 2026 }] })
            .mockResolvedValueOnce({ rows: [] }); // skriningRes kosong sudah cukup

        const wbMock = buatWorkbookMock();
        ExcelJS.Workbook.mockImplementation(() => wbMock);
        const { req, res } = mockReqRes({ params: { id_laporan: 1 } });

        await laporanController.exportExcelKohort(req, res);

        expect(res.headers['Content-Disposition']).toContain('Kohort_Hipertensi_Juni_2026.xlsx');
        expect(res.ended).toBe(true);
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id_laporan: 1 } });

        await laporanController.exportExcelKohort(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 5: renderLaporanPTM()
// ==============================================================
describe('laporanController.renderLaporanPTM()', () => {

    test('happy path → render dengan daftar laporan & periode yang tersedia', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_laporan: 1 }] })
            .mockResolvedValueOnce({ rows: [{ periode_id: 1 }] })
            .mockResolvedValueOnce({ rows: [{ id_jenis_ptm: 'hipertensi', nama_ptm: 'Hipertensi' }] });

        const { req, res } = mockReqRes({ session: { user: { id_user: 3, role: 'pj_ptm' } } });

        await laporanController.renderLaporanPTM(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/laporanptm', expect.objectContaining({
            daftarLaporan: [{ id_laporan: 1 }],
            periodeAda: [{ periode_id: 1 }],
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: { user: { id_user: 3 } } });

        await laporanController.renderLaporanPTM(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 6: exportLaporanExcel()
// ==============================================================
describe('laporanController.exportLaporanExcel()', () => {

    test('laporan tidak ditemukan → 404', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ params: { id_laporan: 999 } });

        await laporanController.exportLaporanExcel(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('laporan ditemukan → workbook dibuat & response Excel dikirim', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_laporan: 1, periode_bulan: 3, periode_tahun: 2026, total_skrining: 0, id_jenis_ptm: 'hipertensi' }] }) // laporanRes
            .mockResolvedValueOnce({ rows: [{ nama_ptm: 'Hipertensi' }] }) // activePtmRes
            .mockResolvedValueOnce({ rows: [] }) // skriningRes
            .mockResolvedValueOnce({ rows: [] }); // kasusRes

        const wbMock = buatWorkbookMock();
        ExcelJS.Workbook.mockImplementation(() => wbMock);
        const { req, res } = mockReqRes({ params: { id_laporan: 1 } });

        await laporanController.exportLaporanExcel(req, res);

        expect(res.headers['Content-Disposition']).toContain('Kohort_Hipertensi_s.d_Maret_2026.xlsx');
        expect(res.ended).toBe(true);
    });

    test('query gagal → status 500 dengan pesan error', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal ambil laporan'));
        const { req, res } = mockReqRes({ params: { id_laporan: 1 } });

        await laporanController.exportLaporanExcel(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('gagal ambil laporan'));
    });

});
