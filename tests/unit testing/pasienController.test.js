const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../../src/config/db');
const pasienController = require('../../src/controllers/pasienController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderDaftarPasien()
// ==============================================================
describe('pasienController.renderDaftarPasien()', () => {

    function setupHappyPath() {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '1' }] })  // countResult
            .mockResolvedValueOnce({ rows: [{ id_pasien: 'P1' }] }) // data
            .mockResolvedValueOnce({ rows: [{ id_nagari: 1 }] }) // nagari dropdown
            .mockResolvedValueOnce({ rows: [{ id_jorong: 1 }] }); // jorong dropdown
    }

    test('tanpa filter → whereClause kosong', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await pasienController.renderDaftarPasien(req, res);

        expect(pool.query.mock.calls[0][0]).not.toContain('WHERE');
        expect(res.render).toHaveBeenCalledWith('kader/pasien', expect.objectContaining({ totalData: 1 }));
    });

    test('dengan search & filter nagari/jorong → parameter dibangun berurutan', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({
            query: { search: 'Ani', nagari: '2', jorong: '5', page: '2' },
            session: {},
        });

        await pasienController.renderDaftarPasien(req, res);

        expect(pool.query.mock.calls[0][1]).toEqual(['%Ani%', '2', '5']);
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await pasienController.renderDaftarPasien(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 2: renderTambahPasien()
// ==============================================================
describe('pasienController.renderTambahPasien()', () => {

    test('happy path → render form tambah pasien dengan dropdown nagari/jorong', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_nagari: 1 }] })
            .mockResolvedValueOnce({ rows: [{ id_jorong: 1 }] });

        const { req, res } = mockReqRes({ session: {} });

        await pasienController.renderTambahPasien(req, res);

        expect(res.render).toHaveBeenCalledWith('kader/tambah_pasien', expect.objectContaining({
            nagari: [{ id_nagari: 1 }],
            jorong: [{ id_jorong: 1 }],
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: {} });

        await pasienController.renderTambahPasien(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 3: handleTambahPasien()
// ==============================================================
describe('pasienController.handleTambahPasien()', () => {

    test('happy path → tahun_lahir dihitung dari usia, redirect ke /pasien', async () => {
        pool.query.mockResolvedValueOnce({});
        const tahunSekarang = new Date().getFullYear();

        const { req, res } = mockReqRes({
            body: {
                id_jorong: 1, nik: '123456', nama_pasien: 'Budi', usia: '40',
                jenis_kelamin: 'Laki-Laki', alamat: 'Jl. A', no_hp: '0812', pekerjaan: 'Tani', agama: 'Islam',
            },
        });

        await pasienController.handleTambahPasien(req, res);

        const values = pool.query.mock.calls[0][1];
        expect(values[0]).toBe('123456'); // id_pasien = nik
        expect(values[5]).toBe(tahunSekarang - 40); // tahun_lahir
        expect(res.redirect).toHaveBeenCalledWith('/pasien');
    });

    test('query gagal → status 500 dengan script alert (bukan crash)', async () => {
        pool.query.mockRejectedValueOnce(new Error('nik duplikat'));
        const { req, res } = mockReqRes({
            body: { id_jorong: 1, nik: '123', nama_pasien: 'Budi', usia: '30' },
        });

        await pasienController.handleTambahPasien(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('alert'));
    });

});
