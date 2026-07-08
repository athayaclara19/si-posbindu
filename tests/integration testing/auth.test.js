const request = require('supertest');
const app     = require('../../app');
const pool    = require('../../src/config/db');
const bcrypt  = require('bcryptjs');

// ──────────────────────────────────────────────────────────────
// SETUP & TEARDOWN
// ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  const hash = await bcrypt.hash('Password123!', 10);
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
      .post('/login').type('form')
      .send({ email: 'test_kader', password: 'Password123!' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  test('kredensial benar (bidan) → redirect ke /bidan', async () => {
    const res = await request(app)
      .post('/login').type('form')
      .send({ email: 'test_bidan', password: 'Password123!' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/bidan');
  });

  test('kredensial benar (pj_ptm) → redirect ke /ptm', async () => {
    const res = await request(app)
      .post('/login').type('form')
      .send({ email: 'test_ptm', password: 'Password123!' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/ptm');
  });

  test('kredensial benar (kepala_puskesmas) → redirect ke /kepala', async () => {
    const res = await request(app)
      .post('/login').type('form')
      .send({ email: 'test_kepala', password: 'Password123!' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/kepala');
  });

  test('password salah → status 200 dan tampil pesan error', async () => {
    const res = await request(app)
      .post('/login').type('form')
      .send({ email: 'test_kader', password: 'passwordSalah' });
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Username atau Password salah/);
  });

  test('username tidak terdaftar → status 200 dan tampil pesan error', async () => {
    const res = await request(app)
      .post('/login').type('form')
      .send({ email: 'user_tidak_ada', password: 'apapun' });
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Username atau Password salah/);
  });

  test('form kosong → tidak crash, tampil halaman login', async () => {
    const res = await request(app)
      .post('/login').type('form')
      .send({ email: '', password: '' });
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
// GRUP 4: Otorisasi role (RBAC)
// ──────────────────────────────────────────────────────────────
describe('Otorisasi lintas role (RBAC)', () => {

  async function loginDan(username, password) {
    const res = await request(app)
      .post('/login').type('form')
      .send({ email: username, password });
    return res.headers['set-cookie'];
  }

  // ── KADER ──
  test('kader tidak bisa akses /bidan → 403', async () => {
    const cookie = await loginDan('test_kader', 'Password123!');
    const res = await request(app).get('/bidan').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('kader tidak bisa akses /ptm → 403', async () => {
    const cookie = await loginDan('test_kader', 'Password123!');
    const res = await request(app).get('/ptm').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('kader tidak bisa akses /kepala → 403', async () => {
    const cookie = await loginDan('test_kader', 'Password123!');
    const res = await request(app).get('/kepala').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('kader bisa akses / → bukan 403 dan bukan redirect login', async () => {
    const cookie = await loginDan('test_kader', 'Password123!');
    const res = await request(app).get('/').set('Cookie', cookie);
    expect(res.statusCode).not.toBe(403);
    if (res.statusCode === 302) {
      expect(res.headers.location).not.toBe('/login');
    }
  });

  // ── BIDAN ──
  test('bidan tidak bisa akses /ptm → 403', async () => {
    const cookie = await loginDan('test_bidan', 'Password123!');
    const res = await request(app).get('/ptm').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('bidan tidak bisa akses /kepala → 403', async () => {
    const cookie = await loginDan('test_bidan', 'Password123!');
    const res = await request(app).get('/kepala').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('bidan bisa akses /bidan → bukan 403 dan bukan redirect login', async () => {
    const cookie = await loginDan('test_bidan', 'Password123!');
    const res = await request(app).get('/bidan').set('Cookie', cookie);
    expect(res.statusCode).not.toBe(403);
    if (res.statusCode === 302) {
      expect(res.headers.location).not.toBe('/login');
    }
  });

  // ── PJ PTM ──
  test('pj_ptm tidak bisa akses /bidan → 403', async () => {
    const cookie = await loginDan('test_ptm', 'Password123!');
    const res = await request(app).get('/bidan').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('pj_ptm tidak bisa akses /kepala → 403', async () => {
    const cookie = await loginDan('test_ptm', 'Password123!');
    const res = await request(app).get('/kepala').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('pj_ptm bisa akses /ptm → bukan 403 dan bukan redirect login', async () => {
    const cookie = await loginDan('test_ptm', 'Password123!');
    const res = await request(app).get('/ptm').set('Cookie', cookie);
    expect(res.statusCode).not.toBe(403);
    if (res.statusCode === 302) {
      expect(res.headers.location).not.toBe('/login');
    }
  });

  // ── KEPALA PUSKESMAS ──
  test('kepala tidak bisa akses /bidan → 403', async () => {
    const cookie = await loginDan('test_kepala', 'Password123!');
    const res = await request(app).get('/bidan').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('kepala tidak bisa akses /ptm → 403', async () => {
    const cookie = await loginDan('test_kepala', 'Password123!');
    const res = await request(app).get('/ptm').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  test('kepala bisa akses /kepala → bukan 403 dan bukan redirect login', async () => {
    const cookie = await loginDan('test_kepala', 'Password123!');
    const res = await request(app).get('/kepala').set('Cookie', cookie);
    expect(res.statusCode).not.toBe(403);
    if (res.statusCode === 302) {
      expect(res.headers.location).not.toBe('/login');
    }
  });

  // ── LOGOUT ──
  test('setelah logout, akses / diarahkan ke /login', async () => {
    const cookie = await loginDan('test_kader', 'Password123!');
    await request(app).get('/logout').set('Cookie', cookie);
    const res = await request(app).get('/').set('Cookie', cookie);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

});
