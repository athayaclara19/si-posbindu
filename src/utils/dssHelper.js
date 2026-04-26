// ============================================================
// FILE: src/utils/dssHelper.js
// Fungsi: Kumpulan fungsi Sistem Pendukung Keputusan (DSS)
// ============================================================

/**
 * FUNGSI DSS: Menganalisa riwayat tekanan darah sistolik pasien.
 *
 * Standar klasifikasi tekanan darah berdasarkan guideline medis:
 *   - Normal          : Sistole < 120
 *   - Pra-Hipertensi  : 120 <= Sistole < 140
 *   - Hipertensi Tkt 1: 140 <= Sistole < 160
 *   - Hipertensi Tkt 2: 160 <= Sistole < 180
 *   - Krisis Hipertensi: Sistole >= 180 (DARURAT!)
 *
 * @param {number[]} historiSistole - Array riwayat nilai sistole pasien,
 *   diurutkan dari yang PALING LAMA ke yang PALING BARU.
 *   Contoh: [150, 160, 175] -> 150 dulu, 175 yang terbaru.
 *
 * @returns {{teksKesimpulan: string, statusColor: string, levelBahaya: string}}
 *   - teksKesimpulan : Saran/peringatan dalam Bahasa Indonesia
 *   - statusColor    : Class warna Tailwind CSS untuk tampilan UI
 *   - levelBahaya    : Label singkat untuk level risiko
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

    // --- TENTUKAN TREN (NAIK / TURUN / STABIL) ---
    let trendTeks = '';
    if (nilaiSebelumnya !== null) {
        const selisih = nilaiTerbaru - nilaiSebelumnya;
        if (selisih > 5) {
            trendTeks = ` Tren: NAIK ${selisih} mmHg dari pemeriksaan sebelumnya.`;
        } else if (selisih < -5) {
            trendTeks = ` Tren: TURUN ${Math.abs(selisih)} mmHg dari pemeriksaan sebelumnya.`;
        } else {
            trendTeks = ' Tren: Relatif STABIL dari pemeriksaan sebelumnya.';
        }
    }

    // --- EVALUASI & HASILKAN KESIMPULAN BERDASARKAN NILAI TERBARU ---

    // LEVEL 5: KRISIS HIPERTENSI - DARURAT!
    if (nilaiTerbaru >= 180) {
        return {
            teksKesimpulan: `⚠️ KRISIS HIPERTENSI! Sistole ${nilaiTerbaru} mmHg. Pasien memerlukan penanganan SEGERA. Rujuk ke fasilitas kesehatan tingkat lanjut tanpa penundaan.${trendTeks}`,
            statusColor:    'text-red-700',
            levelBahaya:    'Krisis',
        };
    }

    // LEVEL 4: HIPERTENSI TINGKAT 2
    if (nilaiTerbaru >= 160) {
        return {
            teksKesimpulan: `🔴 Hipertensi Tingkat 2. Sistole ${nilaiTerbaru} mmHg. Tekanan darah sangat tinggi. Segera konsultasikan dengan dokter dan evaluasi kepatuhan pengobatan.${trendTeks}`,
            statusColor:    'text-red-600',
            levelBahaya:    'Hipertensi Tkt. 2',
        };
    }

    // LEVEL 3: HIPERTENSI TINGKAT 1
    if (nilaiTerbaru >= 140) {
        return {
            teksKesimpulan: `🟠 Hipertensi Tingkat 1. Sistole ${nilaiTerbaru} mmHg. Pantau secara rutin. Anjurkan modifikasi gaya hidup dan pastikan pasien rutin minum obat.${trendTeks}`,
            statusColor:    'text-orange-500',
            levelBahaya:    'Hipertensi Tkt. 1',
        };
    }

    // LEVEL 2: PRA-HIPERTENSI
    if (nilaiTerbaru >= 120) {
        return {
            teksKesimpulan: `🟡 Pra-Hipertensi. Sistole ${nilaiTerbaru} mmHg. Belum termasuk hipertensi, namun perlu waspada. Anjurkan diet sehat, olahraga, dan kurangi garam.${trendTeks}`,
            statusColor:    'text-yellow-500',
            levelBahaya:    'Pra-Hipertensi',
        };
    }

    // LEVEL 1: NORMAL
    return {
        teksKesimpulan: `✅ Tekanan darah Normal. Sistole ${nilaiTerbaru} mmHg. Pertahankan gaya hidup sehat. Tetap lakukan skrining rutin sesuai jadwal.${trendTeks}`,
        statusColor:    'text-green-600',
        levelBahaya:    'Normal',
    };
}


// ============================================================
// CONTOH PENGGUNAAN (Bisa dihapus setelah paham)
// ============================================================
// const hasil = analisaTensiPasien([150, 160, 175]);
// console.log(hasil);
// Output yang diharapkan:
// {
//   teksKesimpulan: '🟠 Hipertensi Tingkat 1. Sistole 175 mmHg. Pantau secara rutin... Tren: NAIK 15 mmHg...',
//   statusColor: 'text-orange-500',
//   levelBahaya: 'Hipertensi Tkt. 1'
// }

// const hasil2 = analisaTensiPasien([200]);
// console.log(hasil2);
// Output yang diharapkan:
// {
//   teksKesimpulan: '⚠️ KRISIS HIPERTENSI! ...',
//   statusColor: 'text-red-700',
//   levelBahaya: 'Krisis'
// }


module.exports = { analisaTensiPasien };


// ============================================================
// ============================================================
// FILE TERPISAH: src/controllers/authController.js
// Ini adalah BONUS: Contoh logika Login yang menghubungkan
// form HTML -> database -> session
// ============================================================
// ============================================================

// const pool   = require('../config/db');
// const bcrypt = require('bcrypt');
//
// /**
//  * Handler untuk POST /login
//  * Menerima username & password dari form, lalu cek ke database.
//  */
// const handleLogin = async (req, res) => {
//     const { username, password } = req.body;
//
//     try {
//         // 1. Cari user berdasarkan username di database
//         const query  = 'SELECT * FROM "user" WHERE username = $1 AND is_active = TRUE LIMIT 1';
//         const result = await pool.query(query, [username]);
//
//         // 2. Jika user tidak ditemukan
//         if (result.rows.length === 0) {
//             return res.render('login', { error: 'Username atau password salah.' });
//         }
//
//         const userDariDB = result.rows[0];
//
//         // 3. Bandingkan password yang diinput dengan hash di database
//         const passwordCocok = await bcrypt.compare(password, userDariDB.password);
//         if (!passwordCocok) {
//             return res.render('login', { error: 'Username atau password salah.' });
//         }
//
//         // 4. Login berhasil! Simpan data penting ke session
//         // JANGAN simpan password ke session, meskipun sudah di-hash!
//         req.session.user = {
//             id_user:    userDariDB.id_user,
//             nama_user:  userDariDB.nama_user,
//             username:   userDariDB.username,
//             role:       userDariDB.role,
//             id_jorong:  userDariDB.id_jorong,
//         };
//
//         // 5. Redirect ke dashboard sesuai role
//         const roleDestination = {
//             'kader':            '/',
//             'bidan':            '/bidan',
//             'pj_ptm':           '/ptm',
//             'kepala_puskesmas': '/kepala',
//         };
//         res.redirect(roleDestination[userDariDB.role] || '/login');
//
//     } catch (err) {
//         console.error('Error saat proses login:', err);
//         res.render('login', { error: 'Terjadi kesalahan server. Coba lagi.' });
//     }
// };
//
// module.exports = { handleLogin };
