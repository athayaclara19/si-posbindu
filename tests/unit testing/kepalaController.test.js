const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
// laporanController di-require secara dinamis di dalam unduhLaporanKepala,
// jadi kita mock juga supaya tidak menyeret dependensi ExcelJS yang berat.
jest.mock('../../src/controllers/laporanController', () => ({
    exportLaporanExcel: jest.fn((req, res) => res.send('excel-mock')),
}));

const pool = require('../../src/config/db');
const laporanController = require('../../src/controllers/laporanController');
const kepalaController = require('../../src/controllers/kepalaController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderDashboardKepala()
// ==============================================================
describe('kepalaController.renderDashboardKepala()', () => {

    function setupHappyPath() {
        pool.query
            .mockResolvedValueOnce({ rows: [{ menunggu: 2, disetujui: 5, ditolak: 1, total: 8 }] }) // stats
            .mockResolvedValueOnce({ rows: [{ total_pasien: 100, terkendali: 40 }] }) // terkendali
            .mockResolvedValueOnce({ rows: [{ id_laporan: 1, periode_bulan: '3', periode_tahun: 2026 }] }) // menunggu
            .mockResolvedValueOnce({ rows: [{ id_laporan: 2, periode_bulan: '2', periode_tahun: 2026 }] }); // riwayat
    }

    test('happy path → persentase terkendali dihitung & nama bulan dikonversi', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ session: { user: { role: 'kepala_puskesmas' } } });

        await kepalaController.renderDashboardKepala(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.persenTerkendali).toBe('40.0');
        expect(data.laporanMenunggu[0].nama_bulan).toBe('Maret');
        expect(data.riwayatLaporan[0].nama_bulan).toBe('Februari');
    });

    test('tidak ada pasien terverifikasi (total_pasien 0) → persenTerkendali "0.0" (tidak NaN)', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ menunggu: 0, disetujui: 0, ditolak: 0, total: 0 }] })
            .mockResolvedValueOnce({ rows: [{ total_pasien: 0, terkendali: 0 }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ session: {} });

        await kepalaController.renderDashboardKepala(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.persenTerkendali).toBe('0.0');
    });

    test('query gagal → status 500 & render halaman 404', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await kepalaController.renderDashboardKepala(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.render).toHaveBeenCalledWith('partials/404', expect.any(Object));
    });

});

// ==============================================================
// GRUP 2: renderPersetujuan()
// ==============================================================
describe('kepalaController.renderPersetujuan()', () => {

    test('tanpa query id → detailLaporan null & distribusiNagari kosong', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_laporan: 1, periode_bulan: '1', periode_tahun: 2026 }] });
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await kepalaController.renderPersetujuan(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.detailLaporan).toBeNull();
        expect(data.distribusiNagari).toEqual([]);
        expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test('dengan query id valid → detailLaporan & distribusiNagari terisi', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] }) // semuaRes
            .mockResolvedValueOnce({ rows: [{ id_laporan: 1, id_periode: 4, periode_bulan: '5', periode_tahun: 2026 }] }) // detRes
            .mockResolvedValueOnce({ rows: [{ nama_nagari: 'Koto Tuo', total_pasien: 10 }] }); // nagariRes

        const { req, res } = mockReqRes({ query: { id: 1 }, session: {} });

        await kepalaController.renderPersetujuan(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.detailLaporan.nama_bulan).toBe('Mei');
        expect(data.distribusiNagari).toEqual([{ nama_nagari: 'Koto Tuo', total_pasien: 10 }]);
    });

    test('query id tidak ditemukan → detailLaporan tetap null', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] }); // detRes kosong

        const { req, res } = mockReqRes({ query: { id: 999 }, session: {} });

        await kepalaController.renderPersetujuan(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.detailLaporan).toBeNull();
    });

    test('query gagal → status 500 & render 404', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await kepalaController.renderPersetujuan(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 3: handleSetujuiLaporan()
// ==============================================================
describe('kepalaController.handleSetujuiLaporan()', () => {

    test('kolom disetujui_oleh & disetujui_pada tersedia → keduanya diisi saat update', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ column_name: 'disetujui_oleh' }, { column_name: 'disetujui_pada' }] })
            .mockResolvedValueOnce({});

        const { req, res } = mockReqRes({ params: { id_laporan: 5 }, session: { user: { id_user: 1 } } });

        await kepalaController.handleSetujuiLaporan(req, res);

        expect(pool.query.mock.calls[1][0]).toContain('disetujui_oleh=$1');
        expect(res.redirect).toHaveBeenCalledWith('/kepala/persetujuan?id=5');
    });

    test('hanya kolom disetujui_pada tersedia → fallback tanpa disetujui_oleh', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ column_name: 'disetujui_pada' }] })
            .mockResolvedValueOnce({});

        const { req, res } = mockReqRes({ params: { id_laporan: 5 }, session: { user: { id_user: 1 } } });

        await kepalaController.handleSetujuiLaporan(req, res);

        expect(pool.query.mock.calls[1][0]).not.toContain('disetujui_oleh');
        expect(pool.query.mock.calls[1][0]).toContain('disetujui_pada=NOW()');
    });

    test('kedua kolom tidak tersedia → fallback hanya update status', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({});

        const { req, res } = mockReqRes({ params: { id_laporan: 5 }, session: { user: { id_user: 1 } } });

        await kepalaController.handleSetujuiLaporan(req, res);

        expect(pool.query.mock.calls[1][0]).toContain("SET status='disetujui', catatan_tolak=NULL");
    });

    test('query gagal → redirect ke /kepala/persetujuan tanpa crash', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id_laporan: 5 }, session: { user: { id_user: 1 } } });

        await kepalaController.handleSetujuiLaporan(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/kepala/persetujuan');
    });

});

// ==============================================================
// GRUP 4: infoLaporanWA()
// ==============================================================
describe('kepalaController.infoLaporanWA()', () => {

    test('laporan disetujui ditemukan → JSON info lengkap', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{
                id_laporan: 1, periode_bulan: '6', periode_tahun: 2026,
                total_pasien: 50, total_skrining: 80, nama_pj: 'Cindy',
            }],
        });
        const { req, res } = mockReqRes({ params: { id_laporan: 1 } });

        await kepalaController.infoLaporanWA(req, res);

        expect(res.json).toHaveBeenCalledWith({
            id_laporan: 1, periode: 'Juni 2026', total_pasien: 50,
            total_skrining: 80, nama_pj: 'Cindy',
        });
    });

    test('laporan tidak ditemukan / belum disetujui → 404 JSON', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ params: { id_laporan: 99 } });

        await kepalaController.infoLaporanWA(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('query gagal → 500 JSON', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id_laporan: 1 } });

        await kepalaController.infoLaporanWA(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 5: handleTolakLaporan()
// ==============================================================
describe('kepalaController.handleTolakLaporan()', () => {

    test('dengan catatan_tolak → disimpan sesuai input, redirect', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({ params: { id_laporan: 3 }, body: { catatan_tolak: 'Data tidak sesuai' } });

        await kepalaController.handleTolakLaporan(req, res);

        expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['Data tidak sesuai', 3]);
        expect(res.redirect).toHaveBeenCalledWith('/kepala/persetujuan');
    });

    test('tanpa catatan_tolak → default "Tidak ada catatan."', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({ params: { id_laporan: 3 }, body: {} });

        await kepalaController.handleTolakLaporan(req, res);

        expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['Tidak ada catatan.', 3]);
    });

    test('query gagal → tetap redirect (tidak crash)', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id_laporan: 3 }, body: {} });

        await kepalaController.handleTolakLaporan(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/kepala/persetujuan');
    });

});

// ==============================================================
// GRUP 6: unduhLaporanKepala()
// ==============================================================
describe('kepalaController.unduhLaporanKepala()', () => {

    test('laporan berstatus disetujui → meneruskan ke laporanController.exportLaporanExcel', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ status: 'disetujui' }] });
        const { req, res } = mockReqRes({ params: { id_laporan: 7 } });

        await kepalaController.unduhLaporanKepala(req, res);

        expect(laporanController.exportLaporanExcel).toHaveBeenCalledWith(req, res);
    });

    test('laporan belum disetujui → 403, tidak meneruskan ke export', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ status: 'dikirim' }] });
        const { req, res } = mockReqRes({ params: { id_laporan: 7 } });

        await kepalaController.unduhLaporanKepala(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(laporanController.exportLaporanExcel).not.toHaveBeenCalled();
    });

    test('laporan tidak ditemukan → 403', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ params: { id_laporan: 999 } });

        await kepalaController.unduhLaporanKepala(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id_laporan: 1 } });

        await kepalaController.unduhLaporanKepala(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 7: renderGrafikKunjungan()
// ==============================================================
describe('kepalaController.renderGrafikKunjungan()', () => {

    test('happy path → label grafik memakai nama bulan + tahun, persen capaian dihitung', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_jenis_ptm: 'hipertensi', nama_ptm: 'Hipertensi' }] }) // ptmRes
            .mockResolvedValueOnce({ rows: [{ bulan: '4', tahun: 2026, total_skrining: 10 }] }) // grafik
            .mockResolvedValueOnce({ rows: [{ periode_bulan: '4', periode_tahun: 2026, total_pasien: 20, terkendali: 10 }] }) // rekap
            .mockResolvedValueOnce({ rows: [{ nama_nagari: 'Koto Tuo' }] }); // nagari

        const { req, res } = mockReqRes({ session: {} });

        await kepalaController.renderGrafikKunjungan(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.grafikData[0].label).toBe('April 2026');
        expect(data.rekapPeriode[0].persen_capaian).toBe('50.0');
        expect(data.rekapPeriode[0].nama_bulan).toBe('April');
    });

    test('total_pasien 0 pada rekap periode → persen_capaian "0.0" (tidak NaN)', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_jenis_ptm: 'hipertensi', nama_ptm: 'Hipertensi' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ periode_bulan: '1', periode_tahun: 2026, total_pasien: 0, terkendali: 0 }] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ session: {} });

        await kepalaController.renderGrafikKunjungan(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.rekapPeriode[0].persen_capaian).toBe('0.0');
    });

    test('query gagal → status 500 & render 404', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await kepalaController.renderGrafikKunjungan(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.render).toHaveBeenCalledWith('partials/404', expect.any(Object));
    });

});
