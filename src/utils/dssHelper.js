// ============================================================
// FILE: src/utils/dssHelper.js
// Fungsi: Kumpulan fungsi Sistem Pendukung Keputusan (DSS)
//
// [REVISI - sesuai arahan dosen bimbingan 30 Apr 2026]
// Fungsi ini HANYA melakukan perhitungan matematis dan
// menghasilkan narasi deskriptif berbasis angka.
// Tidak ada rekomendasi klinis (rujuk dokter, minum obat, dll).
// Klasifikasi kategori tetap dipertahankan karena bersumber dari
// standar baku Kemenkes 2024 yang terdokumentasi.
// ============================================================

/**
 * FUNGSI DSS: Mendeskripsikan riwayat tekanan darah sistolik pasien
 * secara matematis dan faktual (tanpa rekomendasi klinis).
 *
 * Standar klasifikasi tekanan darah (Sumber: Pedoman Pengendalian
 * Hipertensi di FKTP, Kemenkes RI, 2024):
 *   - Normal           : Sistole < 120 mmHg
 *   - Pra-Hipertensi   : 120 <= Sistole < 140 mmHg
 *   - Hipertensi Tkt 1 : 140 <= Sistole < 160 mmHg
 *   - Hipertensi Tkt 2 : 160 <= Sistole < 180 mmHg
 *   - Krisis Hipertensi: Sistole >= 180 mmHg
 *
 * @param {number[]} historiSistole - Array riwayat nilai sistole pasien,
 *   diurutkan dari yang PALING LAMA ke yang PALING BARU.
 *   Contoh: [150, 160, 175] -> 150 dulu, 175 yang terbaru.
 *
 * @returns {{teksKesimpulan: string, statusColor: string, levelBahaya: string}}
 *   - teksKesimpulan : Narasi deskriptif berbasis angka (tanpa rekomendasi klinis)
 *   - statusColor    : Class warna Tailwind CSS untuk tampilan UI
 *   - levelBahaya    : Label singkat kategori berdasarkan standar Kemenkes
 */
function analisaTensiPasien(historiSistole) {

    // --- VALIDASI INPUT ---
    // Jika array kosong atau tidak valid, kembalikan status tidak diketahui
    if (!historiSistole || !Array.isArray(historiSistole) || historiSistole.length === 0) {
        return {
            teksKesimpulan: 'Data riwayat tekanan darah belum tersedia.',
            statusColor:    'text-gray-500',
            levelBahaya:    'Tidak Diketahui',
        };
    }

    // --- AMBIL DATA ---
    const nilaiTerbaru    = historiSistole[historiSistole.length - 1]; // Nilai paling baru
    const nilaiSebelumnya = historiSistole.length >= 2
        ? historiSistole[historiSistole.length - 2]  // Nilai satu sebelum terbaru
        : null;                                       // null jika cuma ada 1 data

    // --- HITUNG RATA-RATA SELURUH RIWAYAT ---
    // [REVISI] Tambah perhitungan rata-rata sebagai data deskriptif
    const jumlahNilai  = historiSistole.reduce((sum, val) => sum + val, 0);
    const rataRata     = Math.round(jumlahNilai / historiSistole.length);
    const jumlahData   = historiSistole.length;

    // --- TENTUKAN TREN (NAIK / TURUN / STABIL) ---
    // [REVISI] Tren hanya menyebutkan angka dan arah, TANPA penilaian klinis
    let trendTeks = '';
    if (nilaiSebelumnya !== null) {
        const selisih = nilaiTerbaru - nilaiSebelumnya;
        if (selisih > 5) {
            // [REVISI] Dihapus: kalimat "tidak terkendali" atau anjuran klinis
            trendTeks = ` Tren: naik ${selisih} mmHg dari pemeriksaan sebelumnya.`;
        } else if (selisih < -5) {
            // [REVISI] Dihapus: kalimat "terkendali" atau penilaian kondisi
            trendTeks = ` Tren: turun ${Math.abs(selisih)} mmHg dari pemeriksaan sebelumnya.`;
        } else {
            trendTeks = ' Tren: stabil dari pemeriksaan sebelumnya.';
        }
    }

    // --- SUSUN NARASI DESKRIPTIF BERBASIS DATA ---
    // [REVISI] Format narasi: hanya menceritakan angka, rata-rata, dan tren.
    // Tidak ada kalimat anjuran, peringatan klinis, atau rekomendasi tindakan.
    const narasiDataPemeriksaan = jumlahData > 1
        ? ` Berdasarkan ${jumlahData} kali pemeriksaan, rata-rata sistolik: ${rataRata} mmHg.`
        : '';

    // --- EVALUASI & HASILKAN DESKRIPSI BERDASARKAN NILAI TERBARU ---
    // Klasifikasi kategori dipertahankan karena berbasis standar Kemenkes 2024.
    // [REVISI] Semua kalimat rekomendasi klinis dihapus dari teksKesimpulan.

    // LEVEL 5: KRISIS HIPERTENSI (Sistole >= 180)
    if (nilaiTerbaru >= 180) {
        return {
            // [REVISI] Dihapus: "Pasien memerlukan penanganan SEGERA. Rujuk ke fasilitas kesehatan..."
            teksKesimpulan: `Sistolik terbaru: ${nilaiTerbaru} mmHg — masuk kategori Krisis Hipertensi (≥180 mmHg).${narasiDataPemeriksaan}${trendTeks}`,
            statusColor:    'text-red-700',
            levelBahaya:    'Krisis',
        };
    }

    // LEVEL 4: HIPERTENSI TINGKAT 2 (160 <= Sistole < 180)
    if (nilaiTerbaru >= 160) {
        return {
            // [REVISI] Dihapus: "Segera konsultasikan dengan dokter dan evaluasi kepatuhan pengobatan."
            teksKesimpulan: `Sistolik terbaru: ${nilaiTerbaru} mmHg — masuk kategori Hipertensi Tingkat 2 (160–179 mmHg).${narasiDataPemeriksaan}${trendTeks}`,
            statusColor:    'text-red-600',
            levelBahaya:    'Hipertensi Tkt. 2',
        };
    }

    // LEVEL 3: HIPERTENSI TINGKAT 1 (140 <= Sistole < 160)
    if (nilaiTerbaru >= 140) {
        return {
            // [REVISI] Dihapus: "Anjurkan modifikasi gaya hidup dan pastikan pasien rutin minum obat."
            teksKesimpulan: `Sistolik terbaru: ${nilaiTerbaru} mmHg — masuk kategori Hipertensi Tingkat 1 (140–159 mmHg).${narasiDataPemeriksaan}${trendTeks}`,
            statusColor:    'text-orange-500',
            levelBahaya:    'Hipertensi Tkt. 1',
        };
    }

    // LEVEL 2: PRA-HIPERTENSI (120 <= Sistole < 140)
    if (nilaiTerbaru >= 120) {
        return {
            // [REVISI] Dihapus: "Anjurkan diet sehat, olahraga, dan kurangi garam."
            teksKesimpulan: `Sistolik terbaru: ${nilaiTerbaru} mmHg — masuk kategori Pra-Hipertensi (120–139 mmHg).${narasiDataPemeriksaan}${trendTeks}`,
            statusColor:    'text-yellow-500',
            levelBahaya:    'Pra-Hipertensi',
        };
    }

    // LEVEL 1: NORMAL (Sistole < 120)
    return {
        // [REVISI] Dihapus: "Pertahankan gaya hidup sehat. Tetap lakukan skrining rutin sesuai jadwal."
        teksKesimpulan: `Sistolik terbaru: ${nilaiTerbaru} mmHg — masuk kategori Normal (<120 mmHg).${narasiDataPemeriksaan}${trendTeks}`,
        statusColor:    'text-green-600',
        levelBahaya:    'Normal',
    };
}


// ============================================================
// CONTOH OUTPUT SETELAH REVISI
//
// Input : analisaTensiPasien([173, 150, 140, 130, 128, 125])
// Output: {
//   teksKesimpulan: "Sistolik terbaru: 125 mmHg — masuk kategori Normal (<120 mmHg).
//                   Berdasarkan 6 kali pemeriksaan, rata-rata sistolik: 141 mmHg.
//                   Tren: turun 3 mmHg dari pemeriksaan sebelumnya.",
//   statusColor: "text-green-600",
//   levelBahaya: "Normal"
// }
//
// Input : analisaTensiPasien([130, 145, 158, 160])
// Output: {
//   teksKesimpulan: "Sistolik terbaru: 160 mmHg — masuk kategori Hipertensi Tingkat 2 (160–179 mmHg).
//                   Berdasarkan 4 kali pemeriksaan, rata-rata sistolik: 148 mmHg.
//                   Tren: naik 2 mmHg dari pemeriksaan sebelumnya.",
//   statusColor: "text-red-600",
//   levelBahaya: "Hipertensi Tkt. 2"
// }
// ============================================================

module.exports = { analisaTensiPasien };