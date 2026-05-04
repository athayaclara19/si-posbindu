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
                p.nik, p.nama_pasien, p.jenis_kelamin, p.tanggal_lahir, p.alamat, 
                j.nama_jorong, n.nama_nagari,
                EXTRACT(MONTH FROM k.tanggal_kegiatan) AS bulan_kegiatan,
                s.sistole, s.diastole, s.status_validasi,
                NULL AS status_ekonomi, NULL AS is_kasus_baru, 
                NULL AS edukasi, NULL AS dapat_obat, NULL AS rujuk
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.nik
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            WHERE k.id_periode = $1 AND s.status_validasi = 'terverifikasi'
            ORDER BY p.nama_pasien ASC, k.tanggal_kegiatan ASC
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

exports.exportLaporanExcel = async (req, res) => {

    // --- LANGKAH 1: Ambil id_laporan dari URL parameter ---
    // Contoh URL: /ptm/laporan/export/5  → id_laporan = 5
    const { id_laporan } = req.params;

    try {
        // --- LANGKAH 2: Cari data laporan + periode di database ---
        const laporanRes = await pool.query(`
            SELECT l.*, p.periode_bulan, p.periode_tahun 
            FROM laporan l 
            JOIN periode p ON l.id_periode = p.periode_id 
            WHERE l.id_laporan = $1
        `, [id_laporan]);

        // Kalau id_laporan tidak ditemukan di DB, kirim error 404
        if (laporanRes.rows.length === 0) {
            return res.status(404).send("Laporan tidak ditemukan.");
        }

        const laporan   = laporanRes.rows[0];
        // Ubah angka bulan (1-12) ke nama bulan Indonesia, misal 1 → "Januari"
        const namaBulan = NAMA_BULAN[laporan.periode_bulan - 1];
        // Format nama file unduhan, contoh: Kohort_Hipertensi_Januari_2025.xlsx
        const namaFile  = `Kohort_Hipertensi_${namaBulan}_${laporan.periode_tahun}.xlsx`;

        // --- LANGKAH 3: Query JOIN untuk data detail pasien ---
        // Mengambil semua skrining yang sudah terverifikasi pada periode laporan ini.
        // JOIN ke tabel: skrining → pasien → kegiatan
        // Catatan: satu pasien bisa muncul lebih dari 1 baris jika ada >1 skrining di bulan itu.
        const skriningRes = await pool.query(`
            SELECT 
                ROW_NUMBER() OVER (ORDER BY p.nama_pasien ASC) AS nomor,
                p.nama_pasien,
                CASE 
                    WHEN p.status_ekonomi ILIKE '%miskin%' THEN 'MISKIN' 
                    ELSE 'TIDAK MISKIN' 
                END AS status_sosial,
                NAMA_BULAN_FUNC(k.bulan_kegiatan)             AS bulan_kasus,
                CASE 
                    WHEN p.is_kasus_baru = true THEN 'Baru' 
                    ELSE 'Lama' 
                END AS kategori_kasus,
                p.nik,
                p.jenis_kelamin,
                DATE_PART('year', AGE(k.tanggal_kegiatan, p.tanggal_lahir)) AS umur,
                j.nama_jorong  AS jorong,
                n.nama_nagari  AS nagari,
                s.sistole,
                s.diastole,
                CASE 
                    WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 'HIPERTENSI'
                    ELSE 'NORMAL'
                END AS status_tekanan,
                s.edukasi,
                s.dapat_obat,
                s.rujuk
            FROM skrining s
            JOIN pasien   p ON s.id_pasien    = p.nik
            JOIN kegiatan k ON s.id_kegiatan  = k.id_kegiatan
            JOIN jorong   j ON p.id_jorong    = j.id_jorong
            JOIN nagari   n ON j.id_nagari    = n.id_nagari
            WHERE k.id_periode       = $1
              AND s.status_validasi  = 'terverifikasi'
            ORDER BY p.nama_pasien ASC, k.tanggal_kegiatan ASC
        `, [laporan.id_periode]);

        // Simpan hasil query ke variabel yang lebih mudah dibaca
        const dataKohort = skriningRes.rows;

        // --- LANGKAH 4: Buat Workbook dan Worksheet dengan ExcelJS ---
        const workbook  = new ExcelJS.Workbook();
        workbook.creator = 'SI-Posbindu PTM';
        workbook.created  = new Date();

        // Nama sheet sesuai format asli Puskesmas
        const worksheet = workbook.addWorksheet('KOHORT HIPERTENSI');

        // -------------------------------------------------------
        // BARIS 1: Judul utama (merge cells A1:AX1)
        // -------------------------------------------------------
        worksheet.mergeCells('A1:AX1');
        const judulCell = worksheet.getCell('A1');
        judulCell.value     = `FORMAT LAPORAN KOHORT HIPERTENSI - ${namaBulan.toUpperCase()} ${laporan.periode_tahun}`;
        judulCell.font      = { bold: true, size: 12 };
        judulCell.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 24;

        // -------------------------------------------------------
        // BARIS 2: Info Puskesmas (opsional, sesuaikan nama)
        // -------------------------------------------------------
        worksheet.mergeCells('A2:AX2');
        const puskesmasCell = worksheet.getCell('A2');
        puskesmasCell.value     = 'PUSKESMAS: ________________________________';
        puskesmasCell.font      = { bold: false, size: 10 };
        puskesmasCell.alignment = { horizontal: 'left', vertical: 'middle' };
        worksheet.getRow(2).height = 18;

        // -------------------------------------------------------
        // BARIS 3 (kosong sebagai spacer)
        // -------------------------------------------------------
        worksheet.getRow(3).height = 6;

        // -------------------------------------------------------
        // BARIS 4: Header Kolom Utama (SESUAI FORMAT KOHORT PUSKESMAS)
        // Urutan: NO | NAMA | STATUS | BULAN KASUS | KATEGORI KASUS |
        //         NIK | JENIS KELAMIN | UMUR | JORONG | NAGARI |
        //         kemudian kolom per-bulan (SISTOLE, DIASTOLE, STATUS, EDUKASI, DAPAT OBAT, RUJUK)
        // -------------------------------------------------------

        // Daftar nama bulan untuk header kolom bulanan
        const BULAN_KOLOM = [
            'JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI',
            'JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'
        ];

        // Kolom-kolom tetap (kiri) — 10 kolom pertama
        const kolomTetap = [
            { header: 'NO',              key: 'no',       width: 5  },
            { header: 'NAMA',            key: 'nama',     width: 25 },
            { header: 'STATUS',          key: 'status',   width: 14 },
            { header: 'BULAN KASUS DITEMUKAN', key: 'bulan_kasus', width: 18 },
            { header: 'KATEGORI KASUS', key: 'kategori', width: 16 },
            { header: 'NIK',             key: 'nik',      width: 20 },
            { header: 'JENIS KELAMIN',   key: 'jk',       width: 14 },
            { header: 'UMUR',            key: 'umur',     width: 8  },
            { header: 'JORONG',          key: 'jorong',   width: 16 },
            { header: 'NAGARI',          key: 'nagari',   width: 16 },
        ];

        // Sub-kolom per bulan — 6 sub-kolom x 12 bulan = 72 kolom
        const subKolomBulan = ['SISTOLE', 'DIASTOLE', 'STATUS', 'EDUKASI', 'DAPAT OBAT', 'RUJUK'];

        // Gabungkan semua kolom: 10 tetap + (12 bulan × 6 sub) = 10 + 72 = 82 kolom
        const semuaKolom = [
            ...kolomTetap,
            ...BULAN_KOLOM.flatMap((namaBln) =>
                subKolomBulan.map((subKol) => ({
                    header: subKol,
                    key:    `${namaBln.toLowerCase()}_${subKol.toLowerCase().replace(/ /g,'_')}`,
                    width:  subKol === 'STATUS' ? 12 : subKol === 'DAPAT OBAT' ? 12 : 10,
                }))
            )
        ];

        // Terapkan kolom ke worksheet
        worksheet.columns = semuaKolom;

        // -------------------------------------------------------
        // BARIS 4: Header baris atas — nama bulan di-merge
        // -------------------------------------------------------
        const HEADER_ROW_BULAN = 4;   // baris header nama bulan (JANUARI, FEBRUARI, dst.)
        const HEADER_ROW_SUB   = 5;   // baris sub-header (SISTOLE, DIASTOLE, STATUS, dst.)
        const DATA_ROW_START   = 6;   // data mulai baris ke-6

        // Merge baris 4-5 untuk kolom tetap (kolom 1-10)
        const kolomMergeLetters = ['A','B','C','D','E','F','G','H','I','J'];
        kolomMergeLetters.forEach((col, idx) => {
            worksheet.mergeCells(`${col}${HEADER_ROW_BULAN}:${col}${HEADER_ROW_SUB}`);
            const cell   = worksheet.getCell(`${col}${HEADER_ROW_BULAN}`);
            cell.value   = kolomTetap[idx].header;
            cell.font    = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border  = {
                top: { style:'thin' }, bottom: { style:'thin' },
                left: { style:'thin' }, right: { style:'thin' }
            };
        });

        // Merge kolom per-bulan (merge 6 sel berturutan di baris 4, lalu isi sub-header di baris 5)
        BULAN_KOLOM.forEach((namaBln, idxBln) => {
            // Kolom mulai: 10 kolom tetap + (6 × idxBln) → index berbasis 1 = 11 + (6 × idxBln)
            const colStart = 11 + (idxBln * 6);
            const colEnd   = colStart + 5;

            // Helper: ubah nomor kolom ke huruf Excel (1=A, 27=AA, dst.)
            const numToCol = (n) => {
                let s = '';
                while (n > 0) {
                    n--;
                    s = String.fromCharCode(65 + (n % 26)) + s;
                    n = Math.floor(n / 26);
                }
                return s;
            };

            const colLetterStart = numToCol(colStart);
            const colLetterEnd   = numToCol(colEnd);

            // Merge sel nama bulan di baris 4
            worksheet.mergeCells(`${colLetterStart}${HEADER_ROW_BULAN}:${colLetterEnd}${HEADER_ROW_BULAN}`);
            const cellBulan   = worksheet.getCell(`${colLetterStart}${HEADER_ROW_BULAN}`);
            cellBulan.value   = namaBln;
            cellBulan.font    = { bold: true, color: { argb: 'FFFFFFFF' } };
            cellBulan.fill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
            cellBulan.alignment = { horizontal: 'center', vertical: 'middle' };
            cellBulan.border  = {
                top: { style:'thin' }, bottom: { style:'thin' },
                left: { style:'thin' }, right: { style:'thin' }
            };

            // Sub-header per bulan di baris 5
            subKolomBulan.forEach((subNama, idxSub) => {
                const subColLetter = numToCol(colStart + idxSub);
                const cellSub      = worksheet.getCell(`${subColLetter}${HEADER_ROW_SUB}`);
                cellSub.value      = subNama;
                cellSub.font       = { bold: true, color: { argb: 'FFFFFFFF' } };
                cellSub.fill       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
                cellSub.alignment  = { horizontal: 'center', vertical: 'middle', wrapText: true };
                cellSub.border     = {
                    top: { style:'thin' }, bottom: { style:'thin' },
                    left: { style:'thin' }, right: { style:'thin' }
                };
            });
        });

        // Atur tinggi baris header
        worksheet.getRow(HEADER_ROW_BULAN).height = 20;
        worksheet.getRow(HEADER_ROW_SUB).height   = 20;

        // --- LANGKAH 5: Masukkan data pasien ke baris Excel ---
        // Karena format Kohort = 1 baris per pasien, kita perlu
        // mengelompokkan data skrining per pasien terlebih dahulu.
        //
        // Pengelompokan: group by NIK, lalu tiap skrining dimasukkan
        // ke kolom bulan yang sesuai.

        // Buat Map: nik → objek data pasien
        const pasienMap = new Map();

        dataKohort.forEach((row) => {
            if (!pasienMap.has(row.nik)) {
                // Inisialisasi data pasien baru
                pasienMap.set(row.nik, {
                    no:           row.nomor,
                    nama:         row.nama_pasien,
                    status:       row.status_sosial,
                    bulan_kasus:  row.bulan_kasus,
                    kategori:     row.kategori_kasus,
                    nik:          row.nik,
                    jk:           row.jenis_kelamin,
                    umur:         row.umur,
                    jorong:       row.jorong,
                    nagari:       row.nagari,
                    bulanData:    {} // tempat data per bulan
                });
            }

            // Ambil objek pasien yang sudah ada, lalu masukkan data skrining ke bulan yang tepat
            const pasien = pasienMap.get(row.nik);

            // Tentukan key bulan dari nama bulan yang datang dari DB
            // misal: bulan_kasus = "Januari" → key = "januari"
            if (row.bulan_kasus) {
                const keyBulan = row.bulan_kasus.toUpperCase();
                // Hanya simpan jika bulan ini valid dan belum ada (ambil data pertama saja per bulan)
                if (!pasien.bulanData[keyBulan]) {
                    pasien.bulanData[keyBulan] = {
                        sistole:    row.sistole   || '',
                        diastole:   row.diastole  || '',
                        status:     row.status_tekanan || '',
                        edukasi:    row.edukasi   || '',
                        dapat_obat: row.dapat_obat || '',
                        rujuk:      row.rujuk      || '',
                    };
                }
            }
        });

        // Loop Map → tambahkan satu baris per pasien ke worksheet
        let nomorUrut = 1;
        pasienMap.forEach((pasien) => {
            // Mulai bangun objek row dengan kolom tetap
            const rowData = {
                no:       nomorUrut++,
                nama:     pasien.nama,
                status:   pasien.status,
                bulan_kasus: pasien.bulan_kasus,
                kategori: pasien.kategori,
                nik:      pasien.nik,
                jk:       pasien.jk,
                umur:     pasien.umur,
                jorong:   pasien.jorong,
                nagari:   pasien.nagari,
            };

            // Tambahkan data per bulan ke row
            BULAN_KOLOM.forEach((bln) => {
                const d = pasien.bulanData[bln] || {};
                const prefix = bln.toLowerCase();
                rowData[`${prefix}_sistole`]    = d.sistole    || '';
                rowData[`${prefix}_diastole`]   = d.diastole   || '';
                rowData[`${prefix}_status`]     = d.status     || '';
                rowData[`${prefix}_edukasi`]    = d.edukasi    || '';
                rowData[`${prefix}_dapat_obat`] = d.dapat_obat || '';
                rowData[`${prefix}_rujuk`]      = d.rujuk      || '';
            });

            // Tambahkan baris ke worksheet
            const excelRow = worksheet.addRow(rowData);
            excelRow.height = 16;

            // Styling baris data (border tipis, alignment tengah)
            excelRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = {
                    top:    { style: 'thin', color: { argb: 'FFDDDDDD' } },
                    bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                    left:   { style: 'thin', color: { argb: 'FFDDDDDD' } },
                    right:  { style: 'thin', color: { argb: 'FFDDDDDD' } },
                };
            });

            // Kolom NAMA align kiri agar lebih mudah dibaca
            excelRow.getCell('nama').alignment = { horizontal: 'left', vertical: 'middle' };
        });

        // --- LANGKAH 6: Set header HTTP agar browser mengunduh file .xlsx ---
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${namaFile}"`
        );

        // Tulis workbook langsung ke response stream → file terunduh
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("❌ Error export Excel Kohort:", err);
        res.status(500).send("Gagal mengunduh Excel Kohort: " + err.message);
    }
};

// =====================================================================
// CATATAN PENTING:
// Jika di DB Anda tidak ada kolom "bulan_kegiatan" di tabel kegiatan,
// ganti baris ini di query:
//   NAMA_BULAN_FUNC(k.bulan_kegiatan) AS bulan_kasus,
// dengan cara ini (ekstrak bulan dari tanggal_kegiatan):
//   TO_CHAR(k.tanggal_kegiatan, 'Month') AS bulan_kasus,
// Sesuaikan juga nama kolom lain (status_ekonomi, is_kasus_baru,
// edukasi, dapat_obat, rujuk) dengan nama kolom di DB Anda.
// =====================================================================
