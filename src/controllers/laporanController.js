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

exports.getPreviewData = async (req, res) => {
    const { bulan, tahun } = req.query;
    try {
        // Cari atau buat periode
        let periodeRes = await pool.query(
            'SELECT periode_id FROM periode WHERE periode_bulan=$1 AND periode_tahun=$2',
            [parseInt(bulan), parseInt(tahun)]
        );

        if (periodeRes.rows.length === 0) {
            // Periode belum ada → berarti belum ada kegiatan di bulan ini
            return res.json({
                total_pasien: 0,
                total_skrining: 0,
                total_hipertensi: 0,
                per_nagari: [],
                narasi: bentukNarasiLaporan(bulan, tahun, 0, 0, 0)
            });
        }

        const id_periode = periodeRes.rows[0].periode_id;

        // Agregat total
        const aggRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien)  AS total_pasien,
                COUNT(s.id_skrining)          AS total_skrining,
                COUNT(CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 1 END) AS total_hipertensi
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
              AND k.id_periode = $1
        `, [id_periode]);

        // Distribusi per nagari
        const nagariRes = await pool.query(`
            SELECT
                n.nama_nagari,
                COUNT(DISTINCT s.id_pasien) AS total_pasien,
                COUNT(CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 1 END) AS hipertensi
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN pasien p   ON s.id_pasien   = p.id_pasien
            JOIN jorong j   ON p.id_jorong   = j.id_jorong
            JOIN nagari n   ON j.id_nagari   = n.id_nagari
            WHERE s.status_validasi = 'terverifikasi'
              AND k.id_periode = $1
            GROUP BY n.nama_nagari
            ORDER BY total_pasien DESC
        `, [id_periode]);

        const agg = aggRes.rows[0];
        const narasi = bentukNarasiLaporan(bulan, tahun, agg.total_pasien, agg.total_skrining, agg.total_hipertensi);

        res.json({
            total_pasien:    parseInt(agg.total_pasien),
            total_skrining:  parseInt(agg.total_skrining),
            total_hipertensi: parseInt(agg.total_hipertensi),
            per_nagari:      nagariRes.rows,
            narasi
        });
    } catch (err) {
        console.error("Error getPreviewData:", err);
        res.status(500).json({ error: err.message });
    }
};


// 1. Generate laporan baru
exports.generateLaporan = async (req, res) => {
    const { periode_bulan, periode_tahun } = req.body;
    const id_pj = req.session.user.id_user;
    try {
        // Cari atau buat periode
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

        // Agregat data skrining terverifikasi
        const agg = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien)  AS total_pasien,
                COUNT(s.id_skrining)          AS total_skrining,
                COUNT(CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 1 END) AS total_hipertensi
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
              AND k.id_periode = $1
        `, [id_periode]);

        const totalPasien    = agg.rows[0].total_pasien;
        const totalSkrining  = agg.rows[0].total_skrining;
        const totalHipertensi = agg.rows[0].total_hipertensi;
        const narasi = bentukNarasiLaporan(periode_bulan, periode_tahun, totalPasien, totalSkrining, totalHipertensi);

        const laporan = await pool.query(`
            INSERT INTO laporan (id_pj, id_periode, total_pasien, total_skrining, status, narasi_laporan)
            VALUES ($1, $2, $3, $4, 'draft', $5)
            ON CONFLICT (id_pj, id_periode) DO UPDATE
            SET total_pasien=$3, total_skrining=$4, status='draft', narasi_laporan=$5
            RETURNING id_laporan
        `, [id_pj, id_periode, totalPasien, totalSkrining, narasi]);

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

        // Ambil semua periode yang punya data skrining terverifikasi
        // agar dropdown hanya tampilkan bulan yang ada datanya
        const periodeAda = await pool.query(`
            SELECT DISTINCT
                per.periode_id,
                per.periode_bulan,
                per.periode_tahun
            FROM periode per
            JOIN kegiatan k ON k.id_periode = per.periode_id
            JOIN skrining s ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
            ORDER BY per.periode_tahun DESC, per.periode_bulan DESC
        `);

        res.render('ptm/laporanptm', {
            daftarLaporan: laporan.rows,
            periodeAda: periodeAda.rows,
            active: 'laporan'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat halaman laporan: " + err.message);
    }
};

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
                p.nik, p.nama_pasien, p.jenis_kelamin, p.tahun_lahir, p.usia, p.alamat, 
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
            // Gunakan usia langsung dari DB, atau hitung dari tahun_lahir jika ada
            const usia = row.usia
                ? row.usia
                : (row.tahun_lahir ? (new Date(row.tanggal_kegiatan).getFullYear() - row.tahun_lahir) : '-');

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

        // Ambil semua periode yang punya data skrining terverifikasi
        // agar dropdown hanya tampilkan bulan yang ada datanya
        const periodeAda = await pool.query(`
            SELECT DISTINCT
                per.periode_id,
                per.periode_bulan,
                per.periode_tahun
            FROM periode per
            JOIN kegiatan k ON k.id_periode = per.periode_id
            JOIN skrining s ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
            ORDER BY per.periode_tahun DESC, per.periode_bulan DESC
        `);

        res.render('ptm/laporanptm', {
            daftarLaporan: laporan.rows,
            periodeAda: periodeAda.rows,
            active: 'laporan'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat halaman laporan: " + err.message);
    }
};



// ============================================================
// 4. Export Laporan ke Excel Kohort (pakai kolom yang pasti ada)
// ============================================================
exports.exportLaporanExcel = async (req, res) => {
    const { id_laporan } = req.params;
    try {
        const laporanRes = await pool.query(`
            SELECT l.*, p.periode_bulan, p.periode_tahun
            FROM laporan l
            JOIN periode p ON l.id_periode = p.periode_id
            WHERE l.id_laporan = $1
        `, [id_laporan]);

        if (laporanRes.rows.length === 0) return res.status(404).send("Laporan tidak ditemukan.");

        const laporan   = laporanRes.rows[0];
        const namaBulan = NAMA_BULAN[laporan.periode_bulan - 1];
        const namaFile  = `Kohort_Hipertensi_${namaBulan}_${laporan.periode_tahun}.xlsx`;

        // Query hanya kolom yang pasti ada di schema
        const skriningRes = await pool.query(`
            SELECT
                ROW_NUMBER() OVER (ORDER BY p.nama_pasien, k.tanggal_kegiatan) AS nomor,
                p.nik,
                p.nama_pasien,
                p.jenis_kelamin,
                p.tanggal_lahir,
                p.alamat,
                j.nama_jorong,
                n.nama_nagari,
                k.tanggal_kegiatan,
                s.sistole,
                s.diastole,
                s.berat_badan,
                s.tinggi_badan,
                s.merokok,
                s.kurang_aktivitas_fisik,
                CASE
                    WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 'HIPERTENSI'
                    ELSE 'NORMAL'
                END AS status_tekanan
            FROM skrining s
            JOIN pasien   p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong   j ON p.id_jorong   = j.id_jorong
            JOIN nagari   n ON j.id_nagari   = n.id_nagari
            WHERE k.id_periode      = $1
              AND s.status_validasi = 'terverifikasi'
            ORDER BY p.nama_pasien ASC, k.tanggal_kegiatan ASC
        `, [laporan.id_periode]);

        const dataKohort = skriningRes.rows;

        const workbook  = new ExcelJS.Workbook();
        workbook.creator = 'SI-Posbindu PTM';
        workbook.created  = new Date();
        const ws = workbook.addWorksheet('KOHORT HIPERTENSI');

        // Baris 1: Judul
        ws.mergeCells('A1:P1');
        const c1 = ws.getCell('A1');
        c1.value     = `LAPORAN KOHORT HIPERTENSI — ${namaBulan.toUpperCase()} ${laporan.periode_tahun}`;
        c1.font      = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        c1.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
        c1.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 26;

        // Baris 2: Info ringkasan
        ws.mergeCells('A2:P2');
        ws.getCell('A2').value = `Dibuat: ${new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' })}   |   Total Pasien: ${laporan.total_pasien}   |   Total Skrining: ${laporan.total_skrining}`;
        ws.getCell('A2').alignment = { horizontal: 'center' };
        ws.getRow(2).height = 18;

        ws.getRow(3).height = 6;

        // Header kolom
        const headers = [
            { header: 'NO',          key: 'no',       width: 5  },
            { header: 'NAMA PASIEN', key: 'nama',     width: 28 },
            { header: 'NIK',         key: 'nik',      width: 20 },
            { header: 'L/P',         key: 'jk',       width: 6  },
            { header: 'USIA',        key: 'usia',     width: 7  },
            { header: 'TGL PERIKSA', key: 'tgl',      width: 14 },
            { header: 'JORONG',      key: 'jorong',   width: 16 },
            { header: 'NAGARI',      key: 'nagari',   width: 16 },
            { header: 'SISTOLE',     key: 'sistole',  width: 10 },
            { header: 'DIASTOLE',    key: 'diastole', width: 10 },
            { header: 'STATUS TD',   key: 'status_td',width: 14 },
            { header: 'BB (kg)',     key: 'bb',       width: 9  },
            { header: 'TB (cm)',     key: 'tb',       width: 9  },
            { header: 'IMT',         key: 'imt',      width: 9  },
            { header: 'MEROKOK',     key: 'rokok',    width: 10 },
            { header: 'AKT. FISIK',  key: 'fisik',    width: 12 },
        ];

        ws.columns = headers;
        ws.getRow(4).eachCell((cell, colNum) => {
            cell.value   = headers[colNum - 1].header;
            cell.font    = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border  = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
        });
        ws.getRow(4).height = 20;

        // Data rows (mulai baris 5)
        dataKohort.forEach((row, idx) => {
            const thnLahir   = row.tanggal_lahir ? new Date(row.tanggal_lahir).getFullYear() : null;
            const thnPeriksa = new Date(row.tanggal_kegiatan).getFullYear();
            const usia       = thnLahir ? (thnPeriksa - thnLahir) : '-';
            const bb  = row.berat_badan  || '';
            const tb  = row.tinggi_badan || '';
            const imt = (bb && tb && parseFloat(tb) > 0)
                ? (parseFloat(bb) / Math.pow(parseFloat(tb) / 100, 2)).toFixed(1)
                : '';

            const isHipertensi = row.sistole >= 140 || row.diastole >= 90;
            const exRow = ws.addRow({
                no:        idx + 1,
                nama:      row.nama_pasien,
                nik:       row.nik,
                jk:        row.jenis_kelamin === 'Laki-Laki' ? 'L' : 'P',
                usia,
                tgl:       new Date(row.tanggal_kegiatan).toLocaleDateString('id-ID'),
                jorong:    row.nama_jorong,
                nagari:    row.nama_nagari,
                sistole:   row.sistole,
                diastole:  row.diastole,
                status_td: row.status_tekanan,
                bb, tb, imt,
                rokok:     row.merokok ? 'Ya' : 'Tidak',
                fisik:     row.kurang_aktivitas_fisik ? 'Kurang' : 'Cukup',
            });

            exRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
                cell.alignment = { vertical: 'middle', horizontal: colNum === 2 ? 'left' : 'center' };
                cell.border = {
                    top:    { style: 'thin', color: { argb: 'FFDDDDDD' } },
                    bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                    left:   { style: 'thin', color: { argb: 'FFDDDDDD' } },
                    right:  { style: 'thin', color: { argb: 'FFDDDDDD' } },
                };
                if (isHipertensi) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } };
                }
            });
            if (isHipertensi) {
                exRow.getCell('status_td').font = { color: { argb: 'FFDC2626' }, bold: true };
            }
            exRow.height = 16;
        });

        // Baris total di akhir
        ws.addRow([]);
        const sumRow = ws.addRow([null, `TOTAL PASIEN: ${laporan.total_pasien}  |  TOTAL SKRINING: ${laporan.total_skrining}`]);
        sumRow.getCell(2).font = { bold: true };
        sumRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${namaFile}"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Error export Excel:", err);
        res.status(500).send("Gagal mengunduh Excel: " + err.message);
    }
};
