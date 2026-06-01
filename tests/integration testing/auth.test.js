const request = require('supertest');
const app     = require('../../app');
const pool    = require('../../src/config/db');
const bcrypt  = require('bcryptjs');

// ──────────────────────────────────────────────────────────────
// SETUP & TEARDOWN
// ──────────────────────────────────────────────────────────────

// Sebelum semua test di file ini: masukkan user dummy ke DB test
beforeAll(async () => {
  const hash = await bcrypt.hash('Password123!', 10);

  // Masukkan 4 user dummy — satu per role
  await pool.query(`
    INSERT INTO "user" (nama_user, username, password, role, is_active)
    VALUES
      ('Test Kader',  'test_kader',  $1, 'kader',            true),
      ('Test Bidan',  'test_bidan',  $1, 'bidan',            true),
      ('Test PTM',    'test_ptm',    $1, 'pj_ptm',           true),
      ('Test Kepala', 'test_kepala', $1, 'kepala_puskesmas', true)
    ON CONFLICT (username) DO NOTHING
  `, [hash]);
});

// Setelah semua test selesai: hapus user dummy dan tutup koneksi pool
afterAll(async () => {
  await pool.query(`
    DELETE FROM "user"
    WHERE username IN ('test_kader', 'test_bidan', 'test_ptm', 'test_kepala')
  `);
  await pool.end();
});

// ──────────────────────────────────────────────────────────────
// GRUP 1: POST /login
// ──────────────────────────────────────────────────────────────
describe('POST /login', () => {

  test('kredensial benar (kader) → redirect 302 ke /', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'test_kader', password: 'Password123!' });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('kredensial benar (bidan) → redirect ke /bidan', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'test_bidan', password: 'Password123!' });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/bidan');
  });

  test('kredensial benar (pj_ptm) → redirect ke /ptm', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'test_ptm', password: 'Password123!' });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/ptm');
  });

  test('kredensial benar (kepala_puskesmas) → redirect ke /kepala', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'test_kepala', password: 'Password123!' });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/kepala');
  });

  test('password salah → status 200 dan tampil pesan error', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'test_kader', password: 'passwordSalah' });

    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Username atau Password salah/);
  });

  test('username tidak terdaftar → status 200 dan tampil pesan error', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'user_tidak_ada', password: 'apapun' });

    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Username atau Password salah/);
  });

  test('form kosong → tidak crash, tampil halaman login', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: '', password: '' });

    // Harus tetap merespons (tidak 500)
    expect(res.statusCode).not.toBe(500);
  });

});

// ──────────────────────────────────────────────────────────────
// GRUP 2: GET /login
// ──────────────────────────────────────────────────────────────
describe('GET /login', () => {

  test('akses halaman login → status 200', async () => {
    const res = await request(app).get('/login');
    expect(res.statusCode).toBe(200);
  });

  test('halaman login berisi form (ada kata login/masuk)', async () => {
    const res = await request(app).get('/login');
    // Halaman harus memuat konten form login
    expect(res.text.toLowerCase()).toMatch(/login|masuk|username|password/i);
  });

});

// ──────────────────────────────────────────────────────────────
// GRUP 3: Proteksi route — tanpa login harus redirect
// ──────────────────────────────────────────────────────────────
describe('Proteksi route tanpa autentikasi', () => {

  test('GET / tanpa login → redirect 302 ke /login', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /bidan tanpa login → redirect ke /login', async () => {
    const res = await request(app).get('/bidan');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /ptm tanpa login → redirect ke /login', async () => {
    const res = await request(app).get('/ptm');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /kepala tanpa login → redirect ke /login', async () => {
    const res = await request(app).get('/kepala');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /ptm/user tanpa login → redirect ke /login', async () => {
    const res = await request(app).get('/ptm/user');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /ptm/pasien tanpa login → redirect ke /login', async () => {
    const res = await request(app).get('/ptm/pasien');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /api/peta-hipertensi tanpa login → redirect ke /login', async () => {
    const res = await request(app).get('/api/peta-hipertensi');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

});

// ──────────────────────────────────────────────────────────────
// GRUP 4: Otorisasi role — login sebagai role A, akses area role B
// ──────────────────────────────────────────────────────────────
describe('Otorisasi lintas role (RBAC)', () => {

  // Helper: login dan ambil cookie session
  async function loginDan(username, password) {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: username, password });
    return res.headers['set-cookie'];
  }

  test('kader tidak bisa akses /bidan → 403', async () => {
    const cookie = await loginDan('test_kader', 'Password123!');
    const res = await request(app)
      .get('/bidan')
      .set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('kader tidak bisa akses /ptm → 403', async () => {
    const cookie = await loginDan('test_kader', 'Password123!');
    const res = await request(app)
      .get('/ptm')
      .set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('kader tidak bisa akses /kepala → 403', async () => {
    const cookie = await loginDan('test_kader', 'Password123!');
    const res = await request(app)
      .get('/kepala')
      .set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('bidan tidak bisa akses /ptm → 403', async () => {
    const cookie = await loginDan('test_bidan', 'Password123!');
    const res = await request(app)
      .get('/ptm')
      .set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('bidan bisa akses /bidan → bukan 403 dan bukan redirect login', async () => {
    const cookie = await loginDan('test_bidan', 'Password123!');
    const res = await request(app)
      .get('/bidan')
      .set('Cookie', cookie);
    // Bisa 200 atau redirect internal, tapi bukan 403 atau redirect ke /login
    expect(res.statusCode).not.toBe(403);
    if (res.statusCode === 302) {
      expect(res.headers.location).not.toBe('/login');
    }
  });

});