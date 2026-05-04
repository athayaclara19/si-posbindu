const pool = require('../config/db');

// [BARU] Array nama bulan untuk konversi angka ke nama (index 0 = Januari)
const NAMA_BULAN = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * [BARU] Fungsi: bentukNarasiLaporan()
 * Menghasilkan string narasi deskriptif berbasis angka murni.
 * TIDAK mengandung rekomendasi klinis — hanya fakta statistik.
 *
 * @param {number} bulan        - Angka bulan (1–12)
 * @param {number} tahun        - Angka tahun (misal 2026)
 * @param {number} totalPasien  - Jumlah pasien unik (COUNT DISTINCT)
 * @param {number} totalSkrining- Jumlah total kunjungan skrining (COUNT)
 * @returns {string}            - Kalimat narasi deskriptif
 */
function bentukNarasiLaporan(bulan, tahun, totalPasien, totalSkrining) {
    // [BARU] Konversi angka bulan ke nama bulan menggunakan array NAMA_BULAN
    const namaBulan = NAMA_BULAN[parseInt(bulan) - 1];

    // [BARU] Hitung rata-rata kunjungan per pasien, dibulatkan 2 desimal
    // Jaga dari pembagian nol jika totalPasien = 0
    const rataRata = totalPasien > 0
        ? (totalSkrining / totalPasien).toFixed(2)
        : '0.00';

    // [BARU] Format angka dengan pemisah ribuan (misal 1480 → "1.480")
    // menggunakan locale 'id-ID' sesuai format Bahasa Indonesia
    const pasienFormatted   = parseInt(totalPasien).toLocaleString('id-ID');
    const skriningFormatted = parseInt(totalSkrining).toLocaleString('id-ID');

    // [BARU] Susun kalimat narasi — hanya fakta angka, tanpa rekomendasi klinis
    const narasi =
        `Pada bulan ${namaBulan} ${tahun}, tercatat ${pasienFormatted} pasien ` +
        `yang menjalani pemeriksaan dengan total ${skriningFormatted} kunjungan skrining. ` +
        `Rata-rata kunjungan per pasien pada periode ini adalah ${rataRata} kali.`;

    return narasi;
}

// 1. Generate laporan baru
exports.generateLaporan = async (req, res) => {
    const { periode_bulan, periode_tahun } = req.body;
    const id_pj = req.session.user.id_user;
    try {
        // Cek apakah periode ada
        let periode = await pool.query(
            'SELECT periode_id FROM periode WHERE periode_bulan=$1 AND periode_tahun=$2',
            [parseInt(periode_bulan), parseInt(periode_tahun)]
        );
        if (periode.rows.length === 0) {
            periode = await pool.query(
                'INSERT INTO periode (periode_bulan, periode_tahun) VALUES ($1,$2) RETURNING periode_id',
                [parseInt(periode_bulan), parseInt(periode_tahun)]
            );
        }
        const id_periode = periode.rows[0].periode_id;

        // Hitung agregat skrining yang terverifikasi
        const agg = await pool.query(`
            SELECT 
                COUNT(DISTINCT s.id_pasien) AS total_pasien,
                COUNT(s.id_skrining)        AS total_skrining
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
            AND k.id_periode = $1
        `, [id_periode]);

        // [BARU] Ambil nilai agregat dari hasil query ke variabel agar lebih mudah dibaca
        const totalPasien   = agg.rows[0].total_pasien;
        const totalSkrining = agg.rows[0].total_skrining;

        // [BARU] Bentuk narasi deskriptif otomatis berdasarkan data agregat
        const narasi = bentukNarasiLaporan(
            periode_bulan,
            periode_tahun,
            totalPasien,
            totalSkrining
        );

        // [DIUBAH] Tambah kolom narasi_laporan pada INSERT dan ON CONFLICT DO UPDATE
        // Sebelumnya: INSERT (id_pj, id_periode, total_pasien, total_skrining, status)
        // Sekarang  : INSERT (id_pj, id_periode, total_pasien, total_skrining, status, narasi_laporan)
        const laporan = await pool.query(`
            INSERT INTO laporan (id_pj, id_periode, total_pasien, total_skrining, status, narasi_laporan)
            VALUES ($1, $2, $3, $4, 'draft', $5)
            ON CONFLICT (id_pj, id_periode) DO UPDATE 
            SET total_pasien=$3, total_skrining=$4, status='draft', narasi_laporan=$5
            RETURNING id_laporan
        `, [id_pj, id_periode, totalPasien, totalSkrining, narasi]); // [DIUBAH] tambah narasi sebagai $5

        res.redirect('/ptm/laporan?generated=' + laporan.rows[0].id_laporan);
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal generate laporan: " + err.message);
    }
};

// 2. Kirim laporan ke Kepala Puskesmas
exports.kirimLaporan = async (req, res) => {
    const { id_laporan } = req.params;
    try {
        await pool.query(
            "UPDATE laporan SET status='dikirim', dikirim_pada=NOW() WHERE id_laporan=$1",
            [id_laporan]
        );
        res.redirect('/ptm/laporan');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal mengirim laporan.");
    }
};

// 3. Render halaman laporan PTM
exports.renderLaporanPTM = async (req, res) => {
    const id_pj = req.session.user.id_user;
    try {
        const laporan = await pool.query(`
            SELECT l.*, per.periode_bulan, per.periode_tahun
            FROM laporan l
            JOIN periode per ON l.id_periode = per.periode_id
            WHERE l.id_pj = $1
            ORDER BY per.periode_tahun DESC, per.periode_bulan DESC
        `, [id_pj]);
        const periode = await pool.query('SELECT * FROM periode ORDER BY periode_tahun DESC, periode_bulan DESC');
        res.render('ptm/laporanptm', { 
            daftarLaporan: laporan.rows, 
            daftarPeriode: periode.rows, 
            active: 'laporan' 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat halaman laporan.");
    }
};