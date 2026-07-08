const request = require('supertest');
const app     = require('../../app');
const pool    = require('../../src/config/db');
const bcrypt  = require('bcryptjs');

// ──────────────────────────────────────────────────────────────
// VARIABEL SHARED
// ──────────────────────────────────────────────────────────────
let idPasien, idKegiatan, idSkrining, idLaporan;

// Gunakan periode LAMPAU agar lolos validasi "tidak boleh masa depan"
const PERIODE_BULAN = 1;
const PERIODE_TAHUN = 2024;

// ──────────────────────────────────────────────────────────────
// SETUP
// ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  const hash = await bcrypt.hash('Password123!', 10);

  // 1. Master data nagari & jorong
  await pool.query(`
    INSERT INTO nagari (id_nagari, nama_nagari, is_active)
    VALUES ('NGR001', 'Balingka', true)
    ON CONFLICT (id_nagari) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO jorong (id_jorong, id_nagari, nama_jorong, is_active)
    VALUES ('JRG001', 'NGR001', 'Koto Hilalang', true)
    ON CONFLICT (id_jorong) DO NOTHING
  `);

  // 2. User dummy 4 role
  await pool.query(`
    INSERT INTO "user" (nama_user, username, password, role, id_jorong, is_active)
    VALUES
      ('Test Kader IT',  'it_kader',  $1, 'kader',            'JRG001', true),
      ('Test Bidan IT',  'it_bidan',  $1, 'bidan',            NULL,     true),
      ('Test PTM IT',    'it_ptm',    $1, 'pj_ptm',           NULL,     true),
      ('Test Kepala IT', 'it_kepala', $1, 'kepala_puskesmas', NULL,     true)
    ON CONFLICT (username) DO NOTHING
  `, [hash]);

  // 3. Pasien dummy
  await pool.query(`
    INSERT INTO pasien (id_pasien, id_jorong, nik, nama_pasien, usia, tahun_lahir, jenis_kelamin)
    VALUES ('9999999999', 'JRG001', '9999999999', 'Pasien Test IT', 50, 1975, 'Perempuan')
    ON CONFLICT (id_pasien) DO NOTHING
  `);
  idPasien = '9999999999';

  // 4. Periode LAMPAU (Januari 2024) + kegiatan
  const resPeriode = await pool.query(`
    INSERT INTO periode (periode_bulan, periode_tahun)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    RETURNING periode_id
  `, [PERIODE_BULAN, PERIODE_TAHUN]);

  let idPeriode;
  if (resPeriode.rows.length > 0) {
    idPeriode = resPeriode.rows[0].periode_id;
  } else {
    const cek = await pool.query(
      `SELECT periode_id FROM periode WHERE periode_bulan=$1 AND periode_tahun=$2`,
      [PERIODE_BULAN, PERIODE_TAHUN]
    );
    idPeriode = cek.rows[0].periode_id;
  }

  const resKegiatan = await pool.query(`
    INSERT INTO kegiatan (tanggal_kegiatan, lokasi, id_jorong, id_periode)
    VALUES ('2024-01-15', 'Lokasi Test IT', 'JRG001', $1)
    RETURNING id_kegiatan
  `, [idPeriode]);
  idKegiatan = resKegiatan.rows[0].id_kegiatan;
});

// ──────────────────────────────────────────────────────────────
// TEARDOWN — TANPA pool.end() agar tidak merusak file test lain
// ──────────────────────────────────────────────────────────────
afterAll(async () => {
  if (idLaporan) {
    await pool.query(`DELETE FROM persetujuan_laporan WHERE id_laporan = $1`, [idLaporan]);
    await pool.query(`DELETE FROM laporan WHERE id_laporan = $1`, [idLaporan]);
  }
  if (idSkrining) {
    await pool.query(`DELETE FROM skrining WHERE id_skrining = $1`, [idSkrining]);
  }
  await pool.query(`DELETE FROM pasien WHERE id_pasien = '9999999999'`);
  await pool.query(`DELETE FROM kegiatan WHERE lokasi = 'Lokasi Test IT'`);
  await pool.query(`
    DELETE FROM "user"
    WHERE username IN ('it_kader', 'it_bidan', 'it_ptm', 'it_kepala')
  `);
});

// ──────────────────────────────────────────────────────────────
// HELPER
// ──────────────────────────────────────────────────────────────
async function loginSebagai(username) {
  const res = await request(app)
    .post('/login')
    .type('form')
    .send({ email: username, password: 'Password123!' });
  return res.headers['set-cookie'];
}

// ══════════════════════════════════════════════════════════════
// PENGUJIAN INTEGRASI
// ══════════════════════════════════════════════════════════════
describe('Pengujian Integrasi: Alur Skrining hingga Persetujuan Laporan', () => {

  // ──────────────────────────────────────────────────────────
  // LANGKAH 1: Kader input skrining
  // ──────────────────────────────────────────────────────────
  test('Langkah 1 — Kader berhasil menyimpan data skrining baru (status: menunggu)', async () => {
    const cookie = await loginSebagai('it_kader');

    const res = await request(app)
      .post('/skrining')
      .set('Cookie', cookie)
      .type('form')
      .send({
        id_pasien:       idPasien,
        id_kegiatan:     idKegiatan,
        sistole:         150,
        diastole:        95,
        berat_badan:     65,
        tinggi_badan:    160,
        gula_darah:      110,
        kolesterol:      200,
        merokok:         'false',
        aktivitas_fisik: 'ringan',
        edukasi:         'diberikan',
        dapat_obat:      'tidak',
        status_rujukan:  'tidak',
      });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/riwayat');

    const dbCheck = await pool.query(
      `SELECT id_skrining, status_validasi FROM skrining
       WHERE id_pasien = $1 AND id_kegiatan = $2
       ORDER BY id_skrining DESC LIMIT 1`,
      [idPasien, idKegiatan]
    );
    expect(dbCheck.rows.length).toBe(1);
    expect(dbCheck.rows[0].status_validasi).toBe('menunggu');

    idSkrining = dbCheck.rows[0].id_skrining;
  });

  // ──────────────────────────────────────────────────────────
  // LANGKAH 2: Bidan validasi
  // ──────────────────────────────────────────────────────────
  test('Langkah 2 — Bidan berhasil memvalidasi skrining (status: terverifikasi)', async () => {
    const cookie = await loginSebagai('it_bidan');

    const res = await request(app)
      .post(`/bidan/validasi/${idSkrining}`)
      .set('Cookie', cookie)
      .type('form')
      .send({
        status_validasi: 'terverifikasi',
        catatan_bidan:   'Data lengkap dan valid',
      });

    expect(res.statusCode).toBe(302);

    const dbCheck = await pool.query(
      `SELECT status_validasi FROM skrining WHERE id_skrining = $1`,
      [idSkrining]
    );
    expect(dbCheck.rows[0].status_validasi).toBe('terverifikasi');
  });

  // ──────────────────────────────────────────────────────────
  // LANGKAH 3: PJ PTM generate laporan
  // generateLaporan butuh periode_bulan & periode_tahun (BUKAN id_periode)
  // ──────────────────────────────────────────────────────────
  test('Langkah 3 — PJ PTM berhasil membuat laporan periode (status: draft)', async () => {
    const cookie = await loginSebagai('it_ptm');

    const res = await request(app)
      .post('/ptm/laporan/generate')
      .set('Cookie', cookie)
      .type('form')
      .send({
        periode_bulan: PERIODE_BULAN,
        periode_tahun: PERIODE_TAHUN,
      });

    // Generate redirect ke /ptm/laporan?generated=ID
    expect([200, 302]).toContain(res.statusCode);

    // Ambil id_laporan dari DB
    const dbCheck = await pool.query(
      `SELECT id_laporan, status FROM laporan
       WHERE id_periode = (
         SELECT periode_id FROM periode
         WHERE periode_bulan = $1 AND periode_tahun = $2
       )
       ORDER BY id_laporan DESC LIMIT 1`,
      [PERIODE_BULAN, PERIODE_TAHUN]
    );
    expect(dbCheck.rows.length).toBeGreaterThan(0);
    expect(dbCheck.rows[0].status).toBe('draft');

    idLaporan = dbCheck.rows[0].id_laporan;
  });

  // ──────────────────────────────────────────────────────────
  // LANGKAH 4: PJ PTM kirim laporan
  // ──────────────────────────────────────────────────────────
  test('Langkah 4 — PJ PTM berhasil mengirim laporan ke Kepala (status: dikirim)', async () => {
    const cookie = await loginSebagai('it_ptm');

    const res = await request(app)
      .post(`/ptm/laporan/kirim/${idLaporan}`)
      .set('Cookie', cookie)
      .type('form')
      .send({});

    expect([200, 302]).toContain(res.statusCode);

    const dbCheck = await pool.query(
      `SELECT status FROM laporan WHERE id_laporan = $1`,
      [idLaporan]
    );
    expect(dbCheck.rows[0].status).toBe('dikirim');
  });

  // ──────────────────────────────────────────────────────────
  // LANGKAH 5: Kepala setujui laporan
  // ──────────────────────────────────────────────────────────
  test('Langkah 5 — Kepala Puskesmas berhasil menyetujui laporan (status: disetujui)', async () => {
    const cookie = await loginSebagai('it_kepala');

    const res = await request(app)
      .post(`/kepala/persetujuan/setujui/${idLaporan}`)
      .set('Cookie', cookie)
      .type('form')
      .send({ catatan: 'Laporan disetujui' });

    expect([200, 302]).toContain(res.statusCode);

    const dbCheck = await pool.query(
      `SELECT status FROM laporan WHERE id_laporan = $1`,
      [idLaporan]
    );
    expect(dbCheck.rows[0].status).toBe('disetujui');
  });

});
