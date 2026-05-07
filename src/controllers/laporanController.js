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
        // 1. Ambil data laporan
        const laporanRes = await pool.query(`
            SELECT l.*, p.periode_bulan, p.periode_tahun
            FROM laporan l
            JOIN periode p ON l.id_periode = p.periode_id
            WHERE l.id_laporan = $1
        `, [id_laporan]);

        if (laporanRes.rows.length === 0) return res.status(404).send("Laporan tidak ditemukan.");

        const laporan  = laporanRes.rows[0];
        const tahun    = laporan.periode_tahun;
        const namaFile = `Kohort_Hipertensi_${tahun}.xlsx`;

        // 2. Ambil semua skrining pasien sepanjang tahun tersebut
        //    Satu baris per pasien per bulan (bukan per kunjungan)
        const skriningRes = await pool.query(`
            SELECT
                p.id_pasien,
                p.nik,
                p.nama_pasien,
                p.jenis_kelamin,
                p.tahun_lahir,
                j.nama_jorong,
                n.nama_nagari,
                EXTRACT(MONTH FROM k.tanggal_kegiatan)::int AS bulan,
                s.sistole,
                s.diastole,
                s.edukasi,
                s.terapi_obat,
                s.status_rujukan,
                CASE WHEN s.sistole >= 140 OR s.diastole >= 90 THEN 'HIPERTENSI' ELSE 'NORMAL' END AS status_td
            FROM skrining s
            JOIN pasien   p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong   j ON p.id_jorong   = j.id_jorong
            JOIN nagari   n ON j.id_nagari   = n.id_nagari
            WHERE EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
              AND s.status_validasi = 'terverifikasi'
            ORDER BY p.nama_pasien ASC, bulan ASC
        `, [tahun]);

        // 3. Ambil info bulan pertama kasus ditemukan per pasien
        const kasusRes = await pool.query(`
            SELECT
                p.id_pasien,
                MIN(EXTRACT(MONTH FROM k.tanggal_kegiatan))::int AS bulan_pertama,
                CASE
                    WHEN MIN(EXTRACT(YEAR FROM k.tanggal_kegiatan)) < $1 THEN 'Lama'
                    ELSE 'Baru'
                END AS kategori_kasus
            FROM skrining s
            JOIN pasien   p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            WHERE s.status_validasi = 'terverifikasi'
            GROUP BY p.id_pasien, EXTRACT(YEAR FROM k.tanggal_kegiatan)
            HAVING EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
        `, [tahun]);

        const kasusMap = {};
        kasusRes.rows.forEach(r => {
            kasusMap[r.id_pasien] = {
                bulan_pertama: r.bulan_pertama,
                kategori: r.kategori_kasus
            };
        });

        // 4. Susun data per pasien: Map id_pasien → { info, bulan: {1: {...}, 2: {...}, ...} }
        const pasienMap = new Map();
        skriningRes.rows.forEach(row => {
            if (!pasienMap.has(row.id_pasien)) {
                const kasus = kasusMap[row.id_pasien] || {};
                pasienMap.set(row.id_pasien, {
                    nik:         row.nik,
                    nama:        row.nama_pasien,
                    jk:          row.jenis_kelamin === 'Laki-Laki' || row.jenis_kelamin === 'Laki-laki' ? 'L' : 'P',
                    usia:        row.tahun_lahir ? (tahun - parseInt(row.tahun_lahir)) : '-',
                    jorong:      row.nama_jorong,
                    nagari:      row.nama_nagari,
                    bulan_kasus: kasus.bulan_pertama ? NAMA_BULAN[kasus.bulan_pertama - 1] : '-',
                    kategori:    kasus.kategori || 'Baru',
                    bulan: {}
                });
            }
            const pasien = pasienMap.get(row.id_pasien);
            pasien.bulan[row.bulan] = {
                sistole:    row.sistole,
                diastole:   row.diastole,
                status:     row.status_td,
                edukasi:    row.edukasi       ? 'Ada' : '',
                dapat_obat: row.terapi_obat   ? 'Iya' : '',
                rujuk:      row.status_rujukan && row.status_rujukan !== 'tidak' ? 'Iya' : '',
            };
        });

        const daftarPasien = Array.from(pasienMap.values());

        // 5. Setup Workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SI-Posbindu PTM';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('KOHORT HIPERTENSI', {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });

        // --- Warna ---
        const BIRU_TUA   = 'FF1D4ED8'; // header judul
        const BIRU       = 'FF2563EB'; // header kolom identitas
        const BIRU_MUDA  = 'FFD1E8FF'; // aksen info
        const MERAH      = 'FFDC2626'; // font HIPERTENSI
        const MERAH_BG   = 'FFFEE2E2'; // bg baris hipertensi
        const ABU        = 'FFF1F5F9'; // bg bulan ganjil (alternating)
        const PUTIH      = 'FFFFFFFF';

        // Warna header per bulan (alternating biru muda & teal muda)
        const BULAN_COLORS = [
            'FF1E3A5F','FF1A4A6E','FF155263','FF0F3D4A','FF0D3B2E','FF1A3C1A',
            'FF3B2F00','FF5C2200','FF5C0A0A','FF4A0A3A','FF2A0A4A','FF0A1A5C'
        ];

        // ── BARIS 1: Judul utama ──────────────────────────────────────────────
        // Kolom identitas = 9, per bulan = 6 kolom × 12 bulan = 72 → total 81 kolom
        const TOTAL_COL = 9 + (6 * 12);

        ws.mergeCells(1, 1, 1, TOTAL_COL);
        const judulCell = ws.getCell('A1');
        judulCell.value     = `FORMAT LAPORAN KOHORT HIPERTENSI TAHUN ${tahun}`;
        judulCell.font      = { bold: true, size: 14, color: { argb: PUTIH }, name: 'Arial' };
        judulCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU_TUA } };
        judulCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 30;

        // ── BARIS 2: Info puskesmas ───────────────────────────────────────────
        ws.mergeCells(2, 1, 2, TOTAL_COL);
        const infoCell = ws.getCell('A2');
        infoCell.value     = `Dicetak: ${new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' })}   |   Total Pasien: ${daftarPasien.length}   |   Total Skrining: ${laporan.total_skrining}`;
        infoCell.font      = { size: 10, color: { argb: BIRU_TUA }, name: 'Arial' };
        infoCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU_MUDA } };
        infoCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(2).height = 18;

        // ── BARIS 3: spasi kecil ──────────────────────────────────────────────
        ws.getRow(3).height = 4;

        // ── BARIS 4: Header kelompok bulan ───────────────────────────────────
        const ID_HEADERS = [
            { label: 'NO',                    width: 5  },
            { label: 'NAMA',                  width: 24 },
            { label: 'BULAN KASUS DITEMUKAN', width: 14 },
            { label: 'KATEGORI KASUS',        width: 13 },
            { label: 'NIK',                   width: 18 },
            { label: 'JENIS KELAMIN',         width: 12 },
            { label: 'UMUR',                  width: 7  },
            { label: 'JORONG',                width: 14 },
            { label: 'NAGARI',                width: 14 },
        ];

        // Set lebar kolom identitas
        ID_HEADERS.forEach((h, i) => {
            ws.getColumn(i + 1).width = h.width;
        });

        // Merge + style kolom identitas (baris 4 dan 5 digabung)
        ID_HEADERS.forEach((h, i) => {
            ws.mergeCells(4, i + 1, 5, i + 1);
            const cell = ws.getCell(4, i + 1);
            cell.value     = h.label;
            cell.font      = { bold: true, size: 9, color: { argb: PUTIH }, name: 'Arial' };
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border    = { top:{style:'thin',color:{argb:'FFFFFFFF'}}, bottom:{style:'thin',color:{argb:'FFFFFFFF'}}, left:{style:'thin',color:{argb:'FFFFFFFF'}}, right:{style:'thin',color:{argb:'FFFFFFFF'}} };
        });

        // Header nama bulan (baris 4) + sub-header bulan (baris 5)
        const SUB_HEADERS = ['SISTOLE', 'DIASTOLE', 'STATUS', 'EDUKASI', 'DAPAT OBAT', 'RUJUK'];
        NAMA_BULAN.forEach((namaBln, blnIdx) => {
            const startCol = 9 + (blnIdx * 6) + 1;
            const endCol   = startCol + 5;
            const warnaBln = BULAN_COLORS[blnIdx];

            // Set lebar kolom bulan
            for (let c = startCol; c <= endCol; c++) {
                ws.getColumn(c).width = (c === startCol || c === startCol + 1) ? 9 : 10;
            }

            // Merge header nama bulan (baris 4)
            ws.mergeCells(4, startCol, 4, endCol);
            const blnCell = ws.getCell(4, startCol);
            blnCell.value     = namaBln.toUpperCase();
            blnCell.font      = { bold: true, size: 9, color: { argb: PUTIH }, name: 'Arial' };
            blnCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: warnaBln } };
            blnCell.alignment = { horizontal: 'center', vertical: 'middle' };
            blnCell.border    = { top:{style:'thin',color:{argb:'FFFFFFFF'}}, bottom:{style:'thin',color:{argb:'FFFFFFFF'}}, left:{style:'medium',color:{argb:'FFFFFFFF'}}, right:{style:'medium',color:{argb:'FFFFFFFF'}} };

            // Sub-header per bulan (baris 5)
            SUB_HEADERS.forEach((sub, subIdx) => {
                const cell = ws.getCell(5, startCol + subIdx);
                cell.value     = sub;
                cell.font      = { bold: true, size: 8, color: { argb: PUTIH }, name: 'Arial' };
                cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: warnaBln } };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                cell.border    = { top:{style:'thin',color:{argb:'FFFFFFFF'}}, bottom:{style:'thin',color:{argb:'FFFFFFFF'}}, left:{style:'thin',color:{argb:'FFFFFFFF'}}, right:{style:'thin',color:{argb:'FFFFFFFF'}} };
            });
        });

        ws.getRow(4).height = 22;
        ws.getRow(5).height = 28;

        // ── BARIS DATA (mulai baris 6) ────────────────────────────────────────
        daftarPasien.forEach((pasien, idx) => {
            const rowNum = 6 + idx;

            // Cek apakah pasien punya riwayat hipertensi di bulan manapun
            const adaHipertensi = Object.values(pasien.bulan).some(b => b.status === 'HIPERTENSI');
            const bgDefault     = adaHipertensi ? MERAH_BG : (idx % 2 === 0 ? PUTIH : ABU);

            // Helper style cell
            const styleCell = (cell, isLeft = false, bgOverride = null) => {
                cell.font      = { size: 9, name: 'Arial' };
                cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgOverride || bgDefault } };
                cell.alignment = { vertical: 'middle', horizontal: isLeft ? 'left' : 'center', wrapText: false };
                cell.border    = {
                    top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
                    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
                    left:   { style: 'thin', color: { argb: 'FFCCCCCC' } },
                    right:  { style: 'thin', color: { argb: 'FFCCCCCC' } },
                };
            };

            // Kolom identitas (9 kolom, tanpa status ekonomi)
            const identitas = [
                idx + 1,
                pasien.nama,
                pasien.bulan_kasus,
                pasien.kategori,
                pasien.nik,
                pasien.jk === 'L' ? 'Laki-Laki' : 'Perempuan',
                pasien.usia,
                pasien.jorong,
                pasien.nagari,
            ];
            identitas.forEach((val, i) => {
                const cell = ws.getCell(rowNum, i + 1);
                cell.value = val;
                styleCell(cell, i === 1 || i === 7 || i === 8);
                if (i === 0) cell.font = { ...cell.font, bold: true };
            });

            // Kolom bulan (1–12)
            for (let bln = 1; bln <= 12; bln++) {
                const startCol = 9 + ((bln - 1) * 6) + 1;
                const data     = pasien.bulan[bln];

                const vals = data
                    ? [data.sistole, data.diastole, data.status, data.edukasi, data.dapat_obat, data.rujuk]
                    : ['', '', '', '', '', ''];

                vals.forEach((val, subIdx) => {
                    const cell = ws.getCell(rowNum, startCol + subIdx);
                    cell.value = val || '';
                    styleCell(cell);

                    // Warna merah untuk STATUS = HIPERTENSI
                    if (subIdx === 2 && val === 'HIPERTENSI') {
                        cell.font = { size: 9, name: 'Arial', bold: true, color: { argb: MERAH } };
                    }
                    // Border tebal di kiri tiap kelompok bulan
                    if (subIdx === 0) {
                        cell.border.left = { style: 'medium', color: { argb: 'FFB0B0B0' } };
                    }
                    if (subIdx === 5) {
                        cell.border.right = { style: 'medium', color: { argb: 'FFB0B0B0' } };
                    }
                });
            }

            ws.getRow(rowNum).height = 15;
        });

        // ── BARIS TOTAL ────────────────────────────────────────────────────────
        const totalRow = 6 + daftarPasien.length;
        ws.mergeCells(totalRow, 1, totalRow, TOTAL_COL);
        const totalCell = ws.getCell(totalRow, 1);
        totalCell.value     = `TOTAL PASIEN: ${daftarPasien.length}   |   TOTAL SKRINING: ${laporan.total_skrining}`;
        totalCell.font      = { bold: true, size: 10, color: { argb: BIRU_TUA }, name: 'Arial' };
        totalCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU_MUDA } };
        totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(totalRow).height = 18;

        // Freeze panes: beku 5 baris header + 10 kolom identitas
        ws.views = [{ state: 'frozen', xSplit: 9, ySplit: 5, topLeftCell: 'J6', activeCell: 'J6' }];

        // ── Kirim file ────────────────────────────────────────────────────────
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${namaFile}"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Error export Excel:", err);
        res.status(500).send("Gagal mengunduh Excel: " + err.message);
    }
};
