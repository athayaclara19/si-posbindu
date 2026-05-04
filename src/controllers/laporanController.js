const pool = require('../config/db');
const ExcelJS = require('exceljs');

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

// ============================================================
// [BARU] 4. Export Laporan ke Excel (Format Kohort Puskesmas)
// ============================================================
exports.exportExcelKohort = async (req, res) => {
    const { id_laporan } = req.params;

    try {
        // 1. Ambil data laporan dan periode
        const laporanRes = await pool.query(`
            SELECT l.*, p.periode_bulan, p.periode_tahun 
            FROM laporan l 
            JOIN periode p ON l.id_periode = p.periode_id 
            WHERE l.id_laporan = $1
        `, [id_laporan]);

        if (laporanRes.rows.length === 0) {
            return res.status(404).send("Laporan tidak ditemukan.");
        }

        const laporan = laporanRes.rows[0];
        const namaBulan = NAMA_BULAN[laporan.periode_bulan - 1];
        const namaFile = `Kohort_Hipertensi_${namaBulan}_${laporan.periode_tahun}.xlsx`;

        // 2. Ambil detail data pasien (skrining) pada periode tersebut
        const skriningRes = await pool.query(`
            SELECT 
                p.nik, p.nama_pasien, p.jenis_kelamin, p.tanggal_lahir, p.alamat, p.no_hp,
                j.nama_jorong, n.nama_nagari,
                k.tanggal_kegiatan,
                s.sistole, s.diastole, s.berat_badan, s.tinggi_badan, s.lingkar_perut, s.imt,
                s.merokok, s.kurang_aktivitas_fisik
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.nik
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            WHERE k.id_periode = $1 AND s.status_validasi = 'terverifikasi'
            ORDER BY k.tanggal_kegiatan ASC, p.nama_pasien ASC
        `, [laporan.id_periode]);

        const dataKohort = skriningRes.rows;

        // 3. Setup Workbook & Worksheet Excel
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SI-Posbindu PTM';
        const worksheet = workbook.addWorksheet('Data Kohort');

        // 4. Bikin Header Kolom Excel
        worksheet.columns = [
            { header: 'No', key: 'no', width: 5 },
            { header: 'Tanggal Periksa', key: 'tgl', width: 15 },
            { header: 'NIK', key: 'nik', width: 20 },
            { header: 'Nama Pasien', key: 'nama', width: 25 },
            { header: 'L/P', key: 'jk', width: 8 },
            { header: 'Usia', key: 'usia', width: 8 },
            { header: 'Alamat', key: 'alamat', width: 30 },
            { header: 'Jorong', key: 'jorong', width: 15 },
            { header: 'Nagari', key: 'nagari', width: 15 },
            { header: 'Sistole', key: 'sistole', width: 10 },
            { header: 'Diastole', key: 'diastole', width: 10 },
            { header: 'BB (kg)', key: 'bb', width: 10 },
            { header: 'TB (cm)', key: 'tb', width: 10 },
            { header: 'IMT', key: 'imt', width: 10 },
            { header: 'Merokok', key: 'rokok', width: 15 },
            { header: 'Aktivitas Fisik', key: 'fisik', width: 20 }
        ];

        // Styling Header (Biar keren: background biru, teks putih, bold)
        worksheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });

        // 5. Masukkan Data ke Excel
        dataKohort.forEach((row, index) => {
            // Hitung usia manual dari tanggal_lahir
            const thnLahir = new Date(row.tanggal_lahir).getFullYear();
            const thnPeriksa = new Date(row.tanggal_kegiatan).getFullYear();
            const usia = thnPeriksa - thnLahir;

            worksheet.addRow({
                no: index + 1,
                tgl: new Date(row.tanggal_kegiatan).toLocaleDateString('id-ID'),
                nik: row.nik,
                nama: row.nama_pasien,
                jk: row.jenis_kelamin === 'Laki-Laki' ? 'L' : 'P',
                usia: usia,
                alamat: row.alamat,
                jorong: row.nama_jorong,
                nagari: row.nama_nagari,
                sistole: row.sistole,
                diastole: row.diastole,
                bb: row.berat_badan,
                tb: row.tinggi_badan,
                imt: row.imt,
                rokok: row.merokok ? 'Ya' : 'Tidak',
                fisik: row.kurang_aktivitas_fisik ? 'Kurang' : 'Cukup'
            });
        });

        // 6. Set Header Response agar langsung download file .xlsx
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${namaFile}`);

        // Tulis ke response
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Error export Excel:", err);
        res.status(500).send("Gagal mengunduh Excel Kohort.");
    }
};