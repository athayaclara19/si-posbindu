const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../../src/config/db');
const rekapController = require('../../src/controllers/rekapController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderRekapBidan()
// ==============================================================
describe('rekapController.renderRekapBidan()', () => {

    test('happy path → render bidan/rekapbidan dengan cards, per jorong, & tren', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ total_pasien: '10', hipertensi: '4', terkendali: '6' }] }) // cards
            .mockResolvedValueOnce({ rows: [{ nama_jorong: 'A', total: '5' }] }) // per jorong
            .mockResolvedValueOnce({ rows: [{ bulan_label: 'Jan 2026', total: '5' }] }); // tren

        const { req, res } = mockReqRes({ session: { user: { role: 'bidan' } } });

        await rekapController.renderRekapBidan(req, res);

        expect(res.render).toHaveBeenCalledWith('bidan/rekapbidan', expect.objectContaining({
            cards: { total_pasien: '10', hipertensi: '4', terkendali: '6' },
            rekapJorong: [{ nama_jorong: 'A', total: '5' }],
            trendBulanan: [{ bulan_label: 'Jan 2026', total: '5' }],
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await rekapController.renderRekapBidan(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 2: renderRekapPTM()
// ==============================================================
describe('rekapController.renderRekapPTM()', () => {

    test('happy path → render ptm/rekapptm dengan rekapData', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_jenis_ptm: 'hipertensi', nama_ptm: 'Hipertensi' }] }) // list PTM
            .mockResolvedValueOnce({ rows: [{ nama_ptm: 'Hipertensi' }] }) // active PTM
            .mockResolvedValueOnce({ rows: [{ periode_id: 1, total_pasien_diperiksa: '20' }] }); // rekap data

        const { req, res } = mockReqRes({ session: { user: { role: 'pj_ptm' } } });

        await rekapController.renderRekapPTM(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/rekapptm', expect.objectContaining({
            rekapData: [{ periode_id: 1, total_pasien_diperiksa: '20' }],
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await rekapController.renderRekapPTM(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 3: renderCetakRekapPeriode()
// ==============================================================
describe('rekapController.renderCetakRekapPeriode()', () => {

    function setupHappyPath() {
        pool.query
            .mockResolvedValueOnce({ rows: [{ periode_id: 1, periode_bulan: '4', periode_tahun: 2026 }] }) // periode
            .mockResolvedValueOnce({ rows: [{ nama_ptm: 'Hipertensi' }] }) // active PTM name
            .mockResolvedValueOnce({ rows: [{ total_pasien: '10', total_kunjungan: '15', total_hipertensi: '3', rata_sistole: '135.5', rata_diastole: '85.2' }] }) // agg
            .mockResolvedValueOnce({ rows: [{ terkendali: '7' }] }) // terkendali
            .mockResolvedValueOnce({ rows: [{ nama_nagari: 'Koto Tuo', total_pasien: '5' }] }); // per nagari
    }

    test('periode tidak ditemukan → 404', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ params: { periode_id: 999 }, session: {} });

        await rekapController.renderCetakRekapPeriode(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('periode ditemukan → nama bulan dikonversi & agregat dihitung', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ params: { periode_id: 1 }, session: {} });

        await rekapController.renderCetakRekapPeriode(req, res);

        const data = res.render.mock.calls[0][1];
        expect(data.namaBulan).toBe('April');
        expect(data.agg.total_pasien).toBe(10);
        expect(data.agg.terkendali).toBe(7);
        expect(data.perNagari).toEqual([{ nama_nagari: 'Koto Tuo', total_pasien: '5' }]);
    });

    test('query gagal → status 500 dengan pesan error', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal ambil rekap'));
        const { req, res } = mockReqRes({ params: { periode_id: 1 }, session: {} });

        await rekapController.renderCetakRekapPeriode(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('gagal ambil rekap'));
    });

});

// ==============================================================
// GRUP 4: renderCetakRekapWilayah()
// ==============================================================
describe('rekapController.renderCetakRekapWilayah()', () => {

    test('happy path → render ptm/cetak_rekap_wilayah dengan agg dan rekapWilayah', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ nama_ptm: 'Hipertensi' }] }) // active PTM
            .mockResolvedValueOnce({ rows: [{ total_pasien: '12', total_kunjungan: '14', total_hipertensi: '4', terkendali: '8' }] }) // agg
            .mockResolvedValueOnce({ rows: [{ nama_wilayah: 'Nagari A', total_pasien: '5' }] }); // rekapWilayah

        const { req, res } = mockReqRes({
            query: { level: 'nagari', jenis_ptm: 'hipertensi', tahun: '2026' },
            session: {}
        });

        await rekapController.renderCetakRekapWilayah(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/cetak_rekap_wilayah', expect.objectContaining({
            levelWilayah: 'nagari',
            rekapWilayah: [{ nama_wilayah: 'Nagari A', total_pasien: '5' }],
            agg: { total_pasien: 12, total_kunjungan: 14, total_hipertensi: 4, terkendali: 8 }
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal ambil rekap wilayah'));
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await rekapController.renderCetakRekapWilayah(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 5: renderCetakDetailWilayah()
// ==============================================================
describe('rekapController.renderCetakDetailWilayah()', () => {

    test('happy path → render ptm/cetak_detail_wilayah dengan agg dan daftarPasien', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ nama_ptm: 'Hipertensi' }] }) // active PTM
            .mockResolvedValueOnce({ rows: [{ nama_nagari: 'Nagari A' }] }) // area info
            .mockResolvedValueOnce({ rows: [{ total_pasien: '15', total_kunjungan: '18', total_hipertensi: '5', terkendali: '10' }] }) // agg
            .mockResolvedValueOnce({ rows: [{ id_pasien: 1, nama_pasien: 'Budi' }] }); // patients

        const { req, res } = mockReqRes({
            query: { level: 'nagari', id: 'NGR001', jenis_ptm: 'hipertensi', tahun: '2026' },
            session: {}
        });

        await rekapController.renderCetakDetailWilayah(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/cetak_detail_wilayah', expect.objectContaining({
            levelWilayah: 'nagari',
            namaWilayah: 'Nagari A',
            daftarPasien: [{ id_pasien: 1, nama_pasien: 'Budi' }],
            agg: { total_pasien: 15, total_kunjungan: 18, total_hipertensi: 5, terkendali: 10 }
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal ambil detail wilayah'));
        const { req, res } = mockReqRes({ query: { level: 'nagari', id: 'NGR001' }, session: {} });

        await rekapController.renderCetakDetailWilayah(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});
