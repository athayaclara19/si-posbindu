const { analisaTensiPasien } = require('../../src/utils/dssHelper');

// ==============================================================
// GRUP 1: Input tidak valid
// ==============================================================
describe('analisaTensiPasien() — input tidak valid', () => {

  test('array kosong → levelBahaya: Tidak Diketahui', () => {
    const hasil = analisaTensiPasien([]);
    expect(hasil.levelBahaya).toBe('Tidak Diketahui');
    expect(hasil.statusColor).toBe('text-gray-500');
  });

  test('null → levelBahaya: Tidak Diketahui', () => {
    const hasil = analisaTensiPasien(null);
    expect(hasil.levelBahaya).toBe('Tidak Diketahui');
  });

  test('undefined → levelBahaya: Tidak Diketahui', () => {
    const hasil = analisaTensiPasien(undefined);
    expect(hasil.levelBahaya).toBe('Tidak Diketahui');
  });

  test('bukan array (string) → levelBahaya: Tidak Diketahui', () => {
    const hasil = analisaTensiPasien('130');
    expect(hasil.levelBahaya).toBe('Tidak Diketahui');
  });

  test('teksKesimpulan input tidak valid → menyebut "belum tersedia"', () => {
    const hasil = analisaTensiPasien([]);
    expect(hasil.teksKesimpulan).toMatch(/belum tersedia/i);
  });

});

// ==============================================================
// GRUP 2: Klasifikasi berdasarkan nilai terbaru
// ==============================================================
describe('analisaTensiPasien() — klasifikasi level bahaya', () => {

  test('sistole 110 → Normal', () => {
    const hasil = analisaTensiPasien([110]);
    expect(hasil.levelBahaya).toBe('Normal');
    expect(hasil.statusColor).toBe('text-green-600');
  });

  test('sistole 119 (batas atas Normal) → Normal', () => {
    const hasil = analisaTensiPasien([119]);
    expect(hasil.levelBahaya).toBe('Normal');
  });

  test('sistole 120 (batas bawah Pra-Hipertensi) → Pra-Hipertensi', () => {
    const hasil = analisaTensiPasien([120]);
    expect(hasil.levelBahaya).toBe('Pra-Hipertensi');
    expect(hasil.statusColor).toBe('text-yellow-500');
  });

  test('sistole 130 → Pra-Hipertensi', () => {
    const hasil = analisaTensiPasien([130]);
    expect(hasil.levelBahaya).toBe('Pra-Hipertensi');
  });

  test('sistole 139 (batas atas Pra-Hipertensi) → Pra-Hipertensi', () => {
    const hasil = analisaTensiPasien([139]);
    expect(hasil.levelBahaya).toBe('Pra-Hipertensi');
  });

  test('sistole 140 (batas bawah Hipertensi Tkt 1) → Hipertensi Tkt. 1', () => {
    const hasil = analisaTensiPasien([140]);
    expect(hasil.levelBahaya).toBe('Hipertensi Tkt. 1');
    expect(hasil.statusColor).toBe('text-orange-500');
  });

  test('sistole 150 → Hipertensi Tkt. 1', () => {
    const hasil = analisaTensiPasien([150]);
    expect(hasil.levelBahaya).toBe('Hipertensi Tkt. 1');
  });

  test('sistole 159 (batas atas Hipertensi Tkt 1) → Hipertensi Tkt. 1', () => {
    const hasil = analisaTensiPasien([159]);
    expect(hasil.levelBahaya).toBe('Hipertensi Tkt. 1');
  });

  test('sistole 160 (batas bawah Hipertensi Tkt 2) → Hipertensi Tkt. 2', () => {
    const hasil = analisaTensiPasien([160]);
    expect(hasil.levelBahaya).toBe('Hipertensi Tkt. 2');
    expect(hasil.statusColor).toBe('text-red-600');
  });

  test('sistole 170 → Hipertensi Tkt. 2', () => {
    const hasil = analisaTensiPasien([170]);
    expect(hasil.levelBahaya).toBe('Hipertensi Tkt. 2');
  });

  test('sistole 179 (batas atas Hipertensi Tkt 2) → Hipertensi Tkt. 2', () => {
    const hasil = analisaTensiPasien([179]);
    expect(hasil.levelBahaya).toBe('Hipertensi Tkt. 2');
  });

  test('sistole 180 (tepat batas Krisis) → Krisis', () => {
    const hasil = analisaTensiPasien([180]);
    expect(hasil.levelBahaya).toBe('Krisis');
    expect(hasil.statusColor).toBe('text-red-700');
  });

  test('sistole 200 → Krisis', () => {
    const hasil = analisaTensiPasien([200]);
    expect(hasil.levelBahaya).toBe('Krisis');
  });

});

// ==============================================================
// GRUP 3: Teks kesimpulan — menyebut nilai terbaru
// ==============================================================
describe('analisaTensiPasien() — isi teksKesimpulan', () => {

  test('teksKesimpulan menyebut nilai sistole terbaru', () => {
    const hasil = analisaTensiPasien([155]);
    expect(hasil.teksKesimpulan).toMatch(/155/);
  });

  test('teksKesimpulan menyebut nilai terbaru dari array multi-data', () => {
    const hasil = analisaTensiPasien([130, 145, 160]);
    // nilai terbaru adalah 160
    expect(hasil.teksKesimpulan).toMatch(/160/);
  });

});

// ==============================================================
// GRUP 4: Tren (naik / turun / stabil)
// ==============================================================
describe('analisaTensiPasien() — deteksi tren', () => {

  test('naik > 5 mmHg → teksKesimpulan mengandung "naik"', () => {
    // 130 → 145, selisih +15 mmHg
    const hasil = analisaTensiPasien([130, 145]);
    expect(hasil.teksKesimpulan).toMatch(/naik/i);
  });

  test('turun > 5 mmHg → teksKesimpulan mengandung "turun"', () => {
    // 160 → 140, selisih -20 mmHg
    const hasil = analisaTensiPasien([160, 140]);
    expect(hasil.teksKesimpulan).toMatch(/turun/i);
  });

  test('selisih tepat 5 mmHg (batas stabil) → teksKesimpulan mengandung "stabil"', () => {
    // 145 → 150, selisih +5 mmHg (tidak > 5, harus stabil)
    const hasil = analisaTensiPasien([145, 150]);
    expect(hasil.teksKesimpulan).toMatch(/stabil/i);
  });

  test('selisih -5 mmHg (batas stabil bawah) → teksKesimpulan mengandung "stabil"', () => {
    const hasil = analisaTensiPasien([150, 145]);
    expect(hasil.teksKesimpulan).toMatch(/stabil/i);
  });

  test('hanya 1 data → tidak ada kata "Tren:" di kesimpulan', () => {
    const hasil = analisaTensiPasien([135]);
    expect(hasil.teksKesimpulan).not.toMatch(/Tren:/i);
  });

});

// ==============================================================
// GRUP 5: Deteksi pola fluktuatif
// ==============================================================
describe('analisaTensiPasien() — deteksi fluktuatif', () => {

  test('pola naik-turun-naik (3 data) → teksKesimpulan mengandung "fluktuatif"', () => {
    // 150 → 170 → 130: ada kenaikan DAN penurunan
    const hasil = analisaTensiPasien([150, 170, 130]);
    expect(hasil.teksKesimpulan).toMatch(/fluktuatif/i);
  });

  test('pola fluktuatif menyebut nilai tertinggi dan terendah', () => {
    const hasil = analisaTensiPasien([150, 170, 130, 160]);
    // maks = 170, min = 130
    expect(hasil.teksKesimpulan).toMatch(/170/);
    expect(hasil.teksKesimpulan).toMatch(/130/);
  });

  test('pola hanya naik terus (3 data) → bukan fluktuatif', () => {
    // 130 → 145 → 160: naik terus, tidak ada penurunan
    const hasil = analisaTensiPasien([130, 145, 160]);
    expect(hasil.teksKesimpulan).not.toMatch(/fluktuatif/i);
  });

  test('pola hanya turun terus (3 data) → bukan fluktuatif', () => {
    // 160 → 150 → 140
    const hasil = analisaTensiPasien([160, 150, 140]);
    expect(hasil.teksKesimpulan).not.toMatch(/fluktuatif/i);
  });

  test('2 data saja → tidak bisa fluktuatif (butuh minimal 3)', () => {
    const hasil = analisaTensiPasien([150, 170]);
    expect(hasil.teksKesimpulan).not.toMatch(/fluktuatif/i);
  });

});

// ==============================================================
// GRUP 6: Rata-rata pada multi-data
// ==============================================================
describe('analisaTensiPasien() — rata-rata pada banyak data', () => {

  test('2 data → teksKesimpulan menyebut "2 kali pemeriksaan"', () => {
    const hasil = analisaTensiPasien([140, 150]);
    expect(hasil.teksKesimpulan).toMatch(/2 kali pemeriksaan/i);
  });

  test('4 data → teksKesimpulan menyebut "4 kali pemeriksaan"', () => {
    const hasil = analisaTensiPasien([130, 140, 150, 160]);
    expect(hasil.teksKesimpulan).toMatch(/4 kali pemeriksaan/i);
  });

  test('rata-rata dihitung dengan benar: [120, 140] → rata-rata 130', () => {
    const hasil = analisaTensiPasien([120, 140]);
    expect(hasil.teksKesimpulan).toMatch(/130/);
  });

  test('1 data → tidak ada narasi "kali pemeriksaan"', () => {
    const hasil = analisaTensiPasien([130]);
    expect(hasil.teksKesimpulan).not.toMatch(/kali pemeriksaan/i);
  });

});