const { mockReqRes } = require('./helpers/httpMocks');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const pool = require('../../src/config/db');
const jadwalController = require('../../src/controllers/jadwalController');

beforeEach(() => {
    jest.clearAllMocks();
});

// ==============================================================
// GRUP 1: renderJadwalKader()
// ==============================================================
describe('jadwalController.renderJadwalKader()', () => {

    test('happy path → render kader/jadwal dengan data jadwal', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_kegiatan: 1 }, { id_kegiatan: 2 }] });
        const { req, res } = mockReqRes({ session: { user: { role: 'kader' } } });

        await jadwalController.renderJadwalKader(req, res);

        expect(res.render).toHaveBeenCalledWith('kader/jadwal', expect.objectContaining({
            jadwal: [{ id_kegiatan: 1 }, { id_kegiatan: 2 }],
            active: 'jadwal',
        }));
    });

    test('query gagal → status 500 dengan pesan error', async () => {
        pool.query.mockRejectedValueOnce(new Error('koneksi db putus'));
        const { req, res } = mockReqRes({ session: {} });

        await jadwalController.renderJadwalKader(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('koneksi db putus'));
    });

});

// ==============================================================
// GRUP 2: renderJadwalPTM()
// ==============================================================
describe('jadwalController.renderJadwalPTM()', () => {

    function setupHappyPath() {
        pool.query
            .mockResolvedValueOnce({ rows: [{ count: '1' }] })  // countResult
            .mockResolvedValueOnce({ rows: [{ id_kegiatan: 1 }] }) // data
            .mockResolvedValueOnce({ rows: [{ id_kegiatan: 1 }] }) // semuaJadwal (kalender)
            .mockResolvedValueOnce({ rows: [{ id_jorong: 1 }] })    // jorong
            .mockResolvedValueOnce({ rows: [{ id_nagari: 1 }] });   // nagari
    }

    test('tanpa filter → render dengan whereClause kosong', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await jadwalController.renderJadwalPTM(req, res);

        const countCall = pool.query.mock.calls[0];
        expect(countCall[0]).not.toContain('WHERE');
        expect(res.render).toHaveBeenCalledWith('ptm/jadwalptm', expect.objectContaining({
            totalData: 1, page: 1,
        }));
    });

    test('filter status "mendatang" → kondisi tanggal > CURRENT_DATE ditambahkan', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ query: { status: 'mendatang' }, session: {} });

        await jadwalController.renderJadwalPTM(req, res);

        expect(pool.query.mock.calls[0][0]).toContain('> CURRENT_DATE');
    });

    test('filter status "selesai" → kondisi tanggal < CURRENT_DATE ditambahkan', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ query: { status: 'selesai' }, session: {} });

        await jadwalController.renderJadwalPTM(req, res);

        expect(pool.query.mock.calls[0][0]).toContain('< CURRENT_DATE');
    });

    test('kalender selalu memakai query terpisah tanpa filter/pagination', async () => {
        setupHappyPath();
        const { req, res } = mockReqRes({ query: { search: 'apapun', page: '3' }, session: {} });

        await jadwalController.renderJadwalPTM(req, res);

        // Panggilan ke-3 adalah query "semuaJadwal" untuk kalender — tanpa parameter filter
        expect(pool.query.mock.calls[2][0]).toContain('ORDER BY k.tanggal_kegiatan DESC');
        expect(pool.query.mock.calls[2].length).toBe(1); // tidak ada array params
    });

    test('query gagal → status 500', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ query: {}, session: {} });

        await jadwalController.renderJadwalPTM(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

});

// ==============================================================
// GRUP 3: handleTambahJadwal()
// ==============================================================
describe('jadwalController.handleTambahJadwal()', () => {

    function tanggalMasaDepan(hari = 10) {
        const d = new Date();
        d.setDate(d.getDate() + hari);
        // Pastikan bukan hari Minggu untuk test yang tidak menguji validasi hari
        if (d.getDay() === 0) d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
    }

    test('field tidak lengkap → redirect error=data_tidak_lengkap', async () => {
        const { req, res } = mockReqRes({ body: { tanggal_kegiatan: '', lokasi: '', id_jorong: '' } });

        await jadwalController.handleTambahJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=data_tidak_lengkap');
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('tanggal masa lalu → redirect error=tanggal_masa_lalu', async () => {
        const { req, res } = mockReqRes({
            body: { tanggal_kegiatan: '2020-01-01', lokasi: 'Balai A', id_jorong: 1 },
        });

        await jadwalController.handleTambahJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=tanggal_masa_lalu');
    });

    test('tanggal jatuh hari Minggu → redirect error=hari_minggu', async () => {
        // Cari hari Minggu terdekat di masa depan
        const d = new Date();
        while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
        const tanggalMinggu = d.toISOString().slice(0, 10);

        const { req, res } = mockReqRes({
            body: { tanggal_kegiatan: tanggalMinggu, lokasi: 'Balai A', id_jorong: 1 },
        });

        await jadwalController.handleTambahJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=hari_minggu');
    });

    test('periode belum ada → dibuat baru lalu kegiatan diinsert, redirect sukses', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [] }) // periode belum ada
            .mockResolvedValueOnce({ rows: [{ periode_id: 99 }] }) // insert periode baru
            .mockResolvedValueOnce({}); // insert kegiatan

        const { req, res } = mockReqRes({
            body: { tanggal_kegiatan: tanggalMasaDepan(), lokasi: 'Balai B', id_jorong: 2 },
        });

        await jadwalController.handleTambahJadwal(req, res);

        expect(pool.query).toHaveBeenCalledTimes(3);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?success=jadwal_ditambah');
    });

    test('periode sudah ada → langsung pakai periode_id yang ada (tanpa insert periode)', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ periode_id: 5 }] }) // periode sudah ada
            .mockResolvedValueOnce({}); // insert kegiatan

        const { req, res } = mockReqRes({
            body: { tanggal_kegiatan: tanggalMasaDepan(), lokasi: 'Balai C', id_jorong: 3 },
        });

        await jadwalController.handleTambahJadwal(req, res);

        expect(pool.query).toHaveBeenCalledTimes(2);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?success=jadwal_ditambah');
    });

    test('query gagal → redirect error=gagal_tambah', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({
            body: { tanggal_kegiatan: tanggalMasaDepan(), lokasi: 'Balai D', id_jorong: 4 },
        });

        await jadwalController.handleTambahJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=gagal_tambah');
    });

});

// ==============================================================
// GRUP 4: renderEditJadwal()
// ==============================================================
describe('jadwalController.renderEditJadwal()', () => {

    test('kegiatan tidak ditemukan → redirect error=tidak_ditemukan', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ params: { id: 999 } });

        await jadwalController.renderEditJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=tidak_ditemukan');
    });

    test('kegiatan ditemukan, belum ada skrining → render dengan sudahAdaSkrining=false', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_kegiatan: 1, lokasi: 'Balai A' }] }) // kegiatan
            .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // skriningCheck
            .mockResolvedValueOnce({ rows: [{ id_jorong: 1 }] }) // jorong
            .mockResolvedValueOnce({ rows: [{ id_nagari: 1 }] }); // nagari

        const { req, res } = mockReqRes({ params: { id: 1 } });

        await jadwalController.renderEditJadwal(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/edit_jadwal', expect.objectContaining({
            sudahAdaSkrining: false,
        }));
    });

    test('kegiatan sudah punya skrining → sudahAdaSkrining=true', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id_kegiatan: 1 }] })
            .mockResolvedValueOnce({ rows: [{ total: 3 }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const { req, res } = mockReqRes({ params: { id: 1 } });

        await jadwalController.renderEditJadwal(req, res);

        expect(res.render).toHaveBeenCalledWith('ptm/edit_jadwal', expect.objectContaining({
            sudahAdaSkrining: true,
        }));
    });

    test('query gagal → redirect error=gagal_muat', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id: 1 } });

        await jadwalController.renderEditJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=gagal_muat');
    });

});

// ==============================================================
// GRUP 5: handleEditJadwal()
// ==============================================================
describe('jadwalController.handleEditJadwal()', () => {

    test('kegiatan sudah lewat (masa lalu) → redirect error=kegiatan_selesai', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ tanggal_kegiatan: '2020-01-01' }] });
        const { req, res } = mockReqRes({
            params: { id: 1 },
            body: { tanggal_kegiatan: '2020-01-02', lokasi: 'A', id_jorong: 1 },
        });

        await jadwalController.handleEditJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=kegiatan_selesai');
    });

    test('sudah ada skrining → hanya update lokasi & jorong, redirect sukses', async () => {
        const besok = new Date(); besok.setDate(besok.getDate() + 5);
        pool.query
            .mockResolvedValueOnce({ rows: [{ tanggal_kegiatan: besok.toISOString() }] }) // kegiatanCheck
            .mockResolvedValueOnce({ rows: [{ total: 2 }] }) // skriningCheck → ada
            .mockResolvedValueOnce({}); // update lokasi & jorong saja

        const { req, res } = mockReqRes({
            params: { id: 1 },
            body: { tanggal_kegiatan: besok.toISOString().slice(0, 10), lokasi: 'Balai Baru', id_jorong: 9 },
        });

        await jadwalController.handleEditJadwal(req, res);

        expect(pool.query).toHaveBeenCalledTimes(3);
        expect(pool.query.mock.calls[2][0]).toContain('SET lokasi = $1, id_jorong = $2');
        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?success=jadwal_diperbarui');
    });

    test('belum ada skrining, tanggal baru jatuh hari Minggu → redirect error=hari_minggu', async () => {
        const d = new Date(); d.setDate(d.getDate() + 30);
        while (d.getDay() !== 0) d.setDate(d.getDate() + 1); // cari hari Minggu

        pool.query
            .mockResolvedValueOnce({ rows: [] }) // kegiatanCheck kosong → lewati cek masa lalu
            .mockResolvedValueOnce({ rows: [{ total: 0 }] }); // skriningCheck → belum ada

        const { req, res } = mockReqRes({
            params: { id: 1 },
            body: { tanggal_kegiatan: d.toISOString().slice(0, 10), lokasi: 'A', id_jorong: 1 },
        });

        await jadwalController.handleEditJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal/edit/1?error=hari_minggu');
    });

    test('belum ada skrining, periode baru → dibuat, lalu update lengkap, redirect sukses', async () => {
        const besok = new Date(); besok.setDate(besok.getDate() + 5);
        if (besok.getDay() === 0) besok.setDate(besok.getDate() + 1);

        pool.query
            .mockResolvedValueOnce({ rows: [] }) // kegiatanCheck kosong
            .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // skriningCheck belum ada
            .mockResolvedValueOnce({ rows: [] }) // periode belum ada
            .mockResolvedValueOnce({ rows: [{ periode_id: 3 }] }) // insert periode baru
            .mockResolvedValueOnce({}); // update kegiatan lengkap

        const { req, res } = mockReqRes({
            params: { id: 1 },
            body: { tanggal_kegiatan: besok.toISOString().slice(0, 10), lokasi: 'A', id_jorong: 1 },
        });

        await jadwalController.handleEditJadwal(req, res);

        expect(pool.query).toHaveBeenCalledTimes(5);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?success=jadwal_diperbarui');
    });

    test('query gagal → redirect error=gagal_edit', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id: 1 }, body: {} });

        await jadwalController.handleEditJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=gagal_edit');
    });

});

// ==============================================================
// GRUP 6: handleHapusJadwal()
// ==============================================================
describe('jadwalController.handleHapusJadwal()', () => {

    test('masih ada skrining terkait → redirect error=ada_skrining, tidak menghapus', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ total: 2 }] });
        const { req, res } = mockReqRes({ params: { id: 1 } });

        await jadwalController.handleHapusJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=ada_skrining');
        expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test('tidak ada skrining → hapus kegiatan, redirect sukses', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ total: 0 }] })
            .mockResolvedValueOnce({});

        const { req, res } = mockReqRes({ params: { id: 1 } });

        await jadwalController.handleHapusJadwal(req, res);

        expect(pool.query).toHaveBeenNthCalledWith(2, 'DELETE FROM kegiatan WHERE id_kegiatan = $1', [1]);
        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?success=jadwal_dihapus');
    });

    test('query gagal → redirect error=gagal_hapus', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id: 1 } });

        await jadwalController.handleHapusJadwal(req, res);

        expect(res.redirect).toHaveBeenCalledWith('/ptm/jadwal?error=gagal_hapus');
    });

});

// ==============================================================
// GRUP 7: getDetailJadwal()
// ==============================================================
describe('jadwalController.getDetailJadwal()', () => {

    test('jadwal ditemukan → mengembalikan JSON detail', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id_kegiatan: 1, jumlah_skrining: 5 }] });
        const { req, res } = mockReqRes({ params: { id: 1 } });

        await jadwalController.getDetailJadwal(req, res);

        expect(res.json).toHaveBeenCalledWith({ id_kegiatan: 1, jumlah_skrining: 5 });
    });

    test('jadwal tidak ditemukan → 404 JSON', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const { req, res } = mockReqRes({ params: { id: 999 } });

        await jadwalController.getDetailJadwal(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Jadwal tidak ditemukan' });
    });

    test('query gagal → 500 JSON', async () => {
        pool.query.mockRejectedValueOnce(new Error('gagal'));
        const { req, res } = mockReqRes({ params: { id: 1 } });

        await jadwalController.getDetailJadwal(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Gagal mengambil detail jadwal' });
    });

});
