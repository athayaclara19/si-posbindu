const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => {
    const mockPool = {
        query: jest.fn((sql, params) => {
            if (sql && sql.includes('SELECT id_skrining FROM skrining')) {
                return Promise.resolve({ rows: [], rowCount: 0 });
            }
            if (sql && sql.includes('SELECT id_jenis_ptm FROM skrining')) {
                return Promise.resolve({ rows: [{ id_jenis_ptm: 'hipertensi' }], rowCount: 1 });
            }
            return Promise.resolve({ rows: [{ id_skrining: 1 }], rowCount: 1 });
        }),
        connect: jest.fn(),
        release: jest.fn()
    };
    mockPool.connect.mockResolvedValue(mockPool);
    return mockPool;
});

const pool = require('../../src/config/db');
const kaderController = require('../../src/controllers/kaderControllers');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderInputSkrining()
// ==============================================================
describe('kaderControllers.renderInputSkrining()', () => {

    test('happy path → render form skrining dengan daftar pasien & kegiatan', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_pasien: '1' }] })
            .mockResolvedValueOnce({ rows: [{ id_kegiatan: 1 }] });

        const { req, res } = mockReqRes({ query: {}, session: { user: { role: 'kader' } } });

        await kaderController.renderInputSkrining(req, res);

        expect(res.render).toHaveBeenCalledWith('kader/skrining', expect.objectContaining({
            pasien: [{ id_pasien: '1' }],
            kegiatan: [{ id_kegiatan: 1 }],
            selectedPasienId: null,
        }));
    });

    test('id_pasien di query → selectedPasienId ikut diteruskan ke view', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ query: { id_pasien: '123' }, session: {} });

        await kaderController.renderInputSkrining(req, res);

        expect(res.render).toHaveBeenCalledWith('kader/skrining', expect.objectContaining({
            selectedPasienId: '123',
        }));
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await kaderController.renderInputSkrining(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 2: handleInputSkrining()
// ==============================================================
describe('kaderControllers.handleInputSkrining()', () => {

    test('happy path → insert skrining dengan nilai default & redirect ke /riwayat', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            body: {
                id_pasien: 'P1', id_kegiatan: 1, sistole: '150', diastole: '95',
                merokok: 'true',
            },
            session: { user: { id_user: 9 } },
        });

        await kaderController.handleInputSkrining(req, res);

        const insertCall = pool.query.mock.calls.find(call => call[0] && call[0].includes('INSERT INTO skrining') && call[0].includes('id_pasien'));
        const values = insertCall ? insertCall[1] : [];
        expect(values[3]).toBe(150); // sistole diparse jadi int
        expect(values[4]).toBe(95);  // diastole diparse jadi int
        expect(values[8]).toBe(true); // merokok === 'true' → true (index 8)
        expect(values[11]).toBe('tidak'); // default dapat_obat (index 11)
        expect(res.redirect).toHaveBeenCalledWith('/riwayat');
    });

    test('merokok "on" (checkbox HTML) → tetap disimpan true', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            body: { id_pasien: 'P2', id_kegiatan: 1, sistole: '120', diastole: '80', merokok: 'on' },
            session: { user: { id_user: 9 } },
        });

        await kaderController.handleInputSkrining(req, res);

        const insertCall = pool.query.mock.calls.find(call => call[0] && call[0].includes('INSERT INTO skrining') && call[0].includes('id_pasien'));
        const values = insertCall ? insertCall[1] : [];
        expect(values[8]).toBe(true);
    });

    test('query gagal → status 500 dengan pesan error', async () => {
        pool.query.mockRejectedValueOnce(new Error('constraint gagal'));
        const { req, res } = mockReqRes({
            body: { id_pasien: 'P3', id_kegiatan: 1, sistole: '140', diastole: '90' },
            session: { user: { id_user: 1 } },
        });

        await kaderController.handleInputSkrining(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('constraint gagal'));
    });

});

// ==============================================================
// GRUP 3: renderDashboard()
// ==============================================================
describe('kaderControllers.renderDashboard()', () => {

    function setupHappyPath() {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '50' }] })   // totalPasien
            .mockResolvedValueOnce({ rows: [{ count: '4' }] })    // pasienBaru
            .mockResolvedValueOnce({ rows: [{ count: '6' }] })    // skriningBulanIni
            .mockResolvedValueOnce({ rows: [{ count: '1' }] })    // menunggu
            .mockResolvedValueOnce({ rows: [{ count: '2' }] })    // revisi
            .mockResolvedValueOnce({ rows: [] })                  // tren
            .mockResolvedValueOnce({ rows: [] })                  // jadwal hari ini
            .mockResolvedValueOnce({ rows: [{ id_skrining: 1, nama_pasien: 'Ani', catatan_bidan: 'perbaiki' }] }) // notifRevisi
            .mockResolvedValueOnce({ rows: [{ id_skrining: 2, nama_pasien: 'Budi' }] }); // notifDisetujui
    }

    test('happy path → statistik & notifikasi gabungan disusun dengan benar', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ session: { user: { id_user: 1, id_jorong: 2 } } });

        await kaderController.renderDashboard(req, res);

        expect(res.render).toHaveBeenCalledWith('kader/dashboard', expect.objectContaining({
            totalPasien: '50',
            menungguValidasi: '1',
            perluRevisi: '2',
        }));
        const dataRendered = res.render.mock.calls[0][1];
        expect(dataRendered.notifikasi).toHaveLength(2);
        expect(dataRendered.notifikasi[0].tipe).toBe('revisi');
        expect(dataRendered.notifikasi[1].tipe).toBe('disetujui');
    });

    test('notifikasi revisi menyertakan pesan catatan bidan', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ session: { user: { id_user: 1, id_jorong: 2 } } });

        await kaderController.renderDashboard(req, res);

        const dataRendered = res.render.mock.calls[0][1];
        expect(dataRendered.notifikasi[0].pesan).toMatch(/perbaiki/);
    });

    test('flash message dihapus setelah dipakai', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({
            session: { user: { id_user: 1, id_jorong: 2 }, successMessage: 'oke', errorMessage: 'gagal' },
        });

        await kaderController.renderDashboard(req, res);

        expect(req.session.successMessage).toBeUndefined();
        expect(req.session.errorMessage).toBeUndefined();
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ session: { user: { id_user: 1, id_jorong: 1 } } });

        await kaderController.renderDashboard(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 4: renderRiwayat()
// ==============================================================
describe('kaderControllers.renderRiwayat()', () => {

    test('tanpa search/status → whereClause hanya berdasarkan id_kader', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '3' }] })
            .mockResolvedValueOnce({ rows: [{ id_skrining: 1 }] });

        const { req, res } = mockReqRes({ query: {}, session: { user: { id_user: 5 } } });

        await kaderController.renderRiwayat(req, res);

        expect(pool.query.mock.calls[0][1]).toEqual([5]);
        expect(res.render).toHaveBeenCalledWith('kader/riwayat', expect.objectContaining({ totalData: 3 }));
    });

    test('dengan search & status label UI → dipetakan ke nilai DB yang benar', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '1' }] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({
            query: { search: 'Ani', status: 'Perlu Revisi' },
            session: { user: { id_user: 5 } },
        });

        await kaderController.renderRiwayat(req, res);

        expect(pool.query.mock.calls[0][1]).toEqual([5, '%Ani%', 'revisi']);
    });

    test('status "Semua" → tidak menambah kondisi status', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '2' }] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ query: { status: 'Semua' }, session: { user: { id_user: 5 } } });

        await kaderController.renderRiwayat(req, res);

        expect(pool.query.mock.calls[0][1]).toEqual([5]);
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ query: {}, session: { user: { id_user: 1 } } });

        await kaderController.renderRiwayat(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 5: renderEditSkrining()
// ==============================================================
describe('kaderControllers.renderEditSkrining()', () => {

    test('data revisi ditemukan → render form edit', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_skrining: 1, status_validasi: 'revisi' }] });
        const { req, res } = mockReqRes({ params: { id_skrining: 1 }, session: {} });

        await kaderController.renderEditSkrining(req, res);

        expect(res.render).toHaveBeenCalledWith('kader/edit_skrining', expect.objectContaining({
            skrining: { id_skrining: 1, status_validasi: 'revisi' },
        }));
    });

    test('data tidak ditemukan / bukan status revisi → 404', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ params: { id_skrining: 99 }, session: {} });

        await kaderController.renderEditSkrining(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id_skrining: 1 }, session: {} });

        await kaderController.renderEditSkrining(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 6: handleEditSkrining()
// ==============================================================
describe('kaderControllers.handleEditSkrining()', () => {

    test('happy path → update data & reset status ke menunggu, redirect ke /riwayat', async () => {
        pool.query.mockResolvedValueOnce({});
        const { req, res } = mockReqRes({
            params: { id_skrining: 1 },
            body: { sistole: '135', diastole: '85', berat_badan: '60' },
        });

        await kaderController.handleEditSkrining(req, res);

        const updateCall = pool.query.mock.calls.find(call => call[0] && call[0].includes('UPDATE skrining'));
        const values = updateCall ? updateCall[1] : [];
        expect(values).toEqual([135, 85, 1]);
        expect(res.redirect).toHaveBeenCalledWith('/riwayat');
    });

    test('query gagal → status 500 dengan pesan error', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal update'));
        const { req, res } = mockReqRes({ params: { id_skrining: 1 }, body: { sistole: '1', diastole: '1' } });

        await kaderController.handleEditSkrining(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('gagal update'));
    });

});
