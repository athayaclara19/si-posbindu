const { isAuthenticated, isAuthorized } = require('../../src/middleware/auth');

// Helper: membuat objek req, res, next tiruan (mock)
function buatMockRRN(sessionUser = null) {
  const req = {
    session: { user: sessionUser }
  };
  const res = {
    redirectTo: null,
    statusCode: null,
    rendered:   null,
    redirect: jest.fn(url  => { res.redirectTo = url; }),
    status:   jest.fn(code => { res.statusCode = code; return res; }),
    render:   jest.fn(view => { res.rendered   = view; }),
  };
  const next = jest.fn();
  return { req, res, next };
}

// ==============================================================
// GRUP 1: isAuthenticated()
// ==============================================================
describe('isAuthenticated()', () => {

  test('user belum login (session.user = null) → redirect ke /login', () => {
    const { req, res, next } = buatMockRRN(null);
    isAuthenticated(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('session sama sekali tidak ada → redirect ke /login', () => {
    const { req, res, next } = buatMockRRN(null);
    req.session = {}; // tidak ada properti user
    isAuthenticated(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('user sudah login (ada session.user) → next() dipanggil', () => {
    const { req, res, next } = buatMockRRN({ id_user: 1, role: 'kader' });
    isAuthenticated(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('user sudah login → redirect TIDAK dipanggil sama sekali', () => {
    const { req, res, next } = buatMockRRN({ id_user: 5, role: 'bidan' });
    isAuthenticated(req, res, next);
    expect(res.redirect).not.toHaveBeenCalled();
  });

});

// ==============================================================
// GRUP 2: isAuthorized() — role tunggal
// ==============================================================
describe('isAuthorized() — satu role diizinkan', () => {

  test('role user cocok dengan role yang diizinkan → next() dipanggil', () => {
    const { req, res, next } = buatMockRRN({ role: 'bidan' });
    isAuthorized('bidan')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('role user tidak cocok → status 403', () => {
    const { req, res, next } = buatMockRRN({ role: 'kader' });
    isAuthorized('bidan')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('role user tidak cocok → render halaman 404/forbidden', () => {
    const { req, res, next } = buatMockRRN({ role: 'kader' });
    isAuthorized('pj_ptm')(req, res, next);
    expect(res.render).toHaveBeenCalled();
    // pastikan view yang di-render adalah halaman error
    expect(res.rendered).toMatch(/404/i);
  });

  test('session.user tidak ada → status 403 (bukan crash)', () => {
    const { req, res, next } = buatMockRRN(null);
    req.session = {}; // tanpa user
    isAuthorized('kader')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

});

// ==============================================================
// GRUP 3: isAuthorized() — multi-role
// ==============================================================
describe('isAuthorized() — beberapa role diizinkan sekaligus', () => {

  test('role cocok dengan salah satu dari banyak role → next() dipanggil', () => {
    const { req, res, next } = buatMockRRN({ role: 'pj_ptm' });
    isAuthorized('bidan', 'pj_ptm')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('role cocok dengan role pertama dalam daftar multi-role → next() dipanggil', () => {
    const { req, res, next } = buatMockRRN({ role: 'bidan' });
    isAuthorized('bidan', 'pj_ptm')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('role tidak cocok dengan satu pun dari banyak role → status 403', () => {
    const { req, res, next } = buatMockRRN({ role: 'kader' });
    isAuthorized('bidan', 'pj_ptm', 'kepala_puskesmas')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('semua role valid tersedia: kader, bidan, pj_ptm, kepala_puskesmas', () => {
    const roles = ['kader', 'bidan', 'pj_ptm', 'kepala_puskesmas'];
    roles.forEach(role => {
      const { req, res, next } = buatMockRRN({ role });
      isAuthorized(...roles)(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

});