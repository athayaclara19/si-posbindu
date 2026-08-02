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
    const { bulan, tahun, jenis_ptm } = req.query;
    const jenisPtmTerpilih = jenis_ptm || 'hipertensi';
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

        let filterAbnormal = 's.sistole >= 140 OR s.diastole >= 90';

        if (jenisPtmTerpilih === 'dm') {
            filterAbnormal = `dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s.gula_darah >= 140`;
        } else if (jenisPtmTerpilih === 'obesitas') {
            filterAbnormal = `obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25`;
        } else if (jenisPtmTerpilih === 'ppok') {
            filterAbnormal = `ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4`;
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            filterAbnormal = `git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'`;
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
            filterAbnormal = `kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6`;
        }

        // Agregat total
        const aggRes = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien)  AS total_pasien,
                COUNT(s.id_skrining)          AS total_skrining,
                COUNT(CASE WHEN ${filterAbnormal} THEN 1 END) AS total_hipertensi
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            WHERE s.status_validasi = 'terverifikasi'
              AND s.id_jenis_ptm = $1
              AND k.id_periode = $2
        `, [jenisPtmTerpilih, id_periode]);

        // Distribusi per nagari
        const nagariRes = await pool.query(`
            SELECT
                n.nama_nagari,
                COUNT(DISTINCT s.id_pasien) AS total_pasien,
                COUNT(CASE WHEN ${filterAbnormal} THEN 1 END) AS hipertensi
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN pasien p   ON s.id_pasien   = p.id_pasien
            JOIN jorong j   ON p.id_jorong   = j.id_jorong
            JOIN nagari n   ON j.id_nagari   = n.id_nagari
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            WHERE s.status_validasi = 'terverifikasi'
              AND s.id_jenis_ptm = $1
              AND k.id_periode = $2
            GROUP BY n.nama_nagari
            ORDER BY total_pasien DESC
        `, [jenisPtmTerpilih, id_periode]);

        const agg = aggRes.rows[0];
        const narasi = bentukNarasiLaporan(bulan, tahun, agg.total_pasien, agg.total_skrining, agg.total_hipertensi);

        res.json({
            total_pasien:    parseInt(agg.total_pasien) || 0,
            total_skrining:  parseInt(agg.total_skrining) || 0,
            total_hipertensi: parseInt(agg.total_hipertensi) || 0,
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
    const { periode_bulan, periode_tahun, id_jenis_ptm } = req.body;
    const jenisPtmTerpilih = id_jenis_ptm || 'hipertensi';
    const id_pj = req.session.user.id_user;

    // ================================================================
    // VALIDASI: Cegah generate laporan untuk periode MASA DEPAN
    // Contoh: jika sekarang Mei 2025, tidak boleh generate Juni 2025+
    // ================================================================
    const sekarang   = new Date();
    const bulanSkrg  = sekarang.getMonth() + 1; // getMonth() mulai 0, +1 agar jadi 1-12
    const tahunSkrg  = sekarang.getFullYear();
    const bulanInput = parseInt(periode_bulan);
    const tahunInput = parseInt(periode_tahun);

    const isMasaDepan = tahunInput > tahunSkrg ||
                        (tahunInput === tahunSkrg && bulanInput > bulanSkrg);

    if (isMasaDepan) {
        return res.redirect('/ptm/rekap?error=periode_masa_depan');
    }
    // ================================================================

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

        let filterAbnormal = 's.sistole >= 140 OR s.diastole >= 90';

        if (jenisPtmTerpilih === 'dm') {
            filterAbnormal = `dmt.kategori_hasil IN ('Diabetes Melitus', 'Prediabetes') OR s.gula_darah >= 140`;
        } else if (jenisPtmTerpilih === 'obesitas') {
            filterAbnormal = `obt.kategori_obesitas IN ('Obesitas', 'Overweight') OR obt.imt >= 25`;
        } else if (jenisPtmTerpilih === 'ppok') {
            filterAbnormal = `ppt.kategori_risiko = 'Tinggi' OR ppt.skor_total >= 4`;
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            filterAbnormal = `git.hasil_pemeriksaan_mata <> 'Normal' OR git.hasil_pemeriksaan_telinga <> 'Normal'`;
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
            filterAbnormal = `kjt.kategori_hasil <> 'Normal' OR kjt.skor_total >= 6`;
        }

        // Agregat data skrining terverifikasi
        const agg = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id_pasien)  AS total_pasien,
                COUNT(s.id_skrining)          AS total_skrining,
                COUNT(CASE WHEN ${filterAbnormal} THEN 1 END) AS total_hipertensi
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            LEFT JOIN skrining_hipertensi hp ON s.id_skrining = hp.id_skrining
            LEFT JOIN skrining_dm dmt ON s.id_skrining = dmt.id_skrining
            LEFT JOIN skrining_obesitas obt ON s.id_skrining = obt.id_skrining
            LEFT JOIN skrining_ppok ppt ON s.id_skrining = ppt.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON s.id_skrining = git.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON s.id_skrining = kjt.id_skrining
            WHERE s.status_validasi = 'terverifikasi'
              AND s.id_jenis_ptm = $1
              AND k.id_periode = $2
        `, [jenisPtmTerpilih, id_periode]);

        const totalPasien    = agg.rows[0].total_pasien || 0;
        const totalSkrining  = agg.rows[0].total_skrining || 0;
        const totalHipertensi = agg.rows[0].total_hipertensi || 0;
        const narasi = bentukNarasiLaporan(periode_bulan, periode_tahun, totalPasien, totalSkrining, totalHipertensi);

        const laporan = await pool.query(`
            INSERT INTO laporan (id_pj, id_periode, id_jenis_ptm, total_pasien, total_skrining, status, narasi_laporan)
            VALUES ($1, $2, $3, $4, $5, 'draft', $6)
            ON CONFLICT (id_pj, id_periode, id_jenis_ptm) DO UPDATE
            SET total_pasien=$4, total_skrining=$5, status='draft', narasi_laporan=$6
            RETURNING id_laporan
        `, [id_pj, id_periode, jenisPtmTerpilih, totalPasien, totalSkrining, narasi]);

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
        // FIX: Hanya boleh kirim laporan yang masih berstatus 'draft'
        // Mencegah laporan yang sudah 'disetujui' dikirim ulang via URL langsung
        const result = await pool.query(
            "UPDATE laporan SET status='dikirim', dikirim_pada=NOW() WHERE id_laporan=$1 AND status='draft' RETURNING id_laporan",
            [id_laporan]
        );
        if (result.rowCount === 0) {
            // Laporan tidak ditemukan atau bukan draft — tidak perlu error, cukup redirect
            return res.redirect('/ptm/laporan?error=laporan_sudah_dikirim');
        }
        res.redirect('/ptm/laporan');
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal mengirim laporan.");
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
                s.berat_badan, s.tinggi_badan, s.merokok, s.aktivitas_fisik,
                obt.imt,
                NULL AS status_ekonomi, NULL AS is_kasus_baru, 
                NULL AS edukasi, NULL AS dapat_obat, NULL AS rujuk
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong j ON p.id_jorong = j.id_jorong
            JOIN nagari n ON j.id_nagari = n.id_nagari
            LEFT JOIN skrining_obesitas obt ON obt.id_skrining = s.id_skrining
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
                fisik: row.aktivitas_fisik || '-'
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
            SELECT l.*, per.periode_bulan, per.periode_tahun, jp.nama_ptm
            FROM laporan l
            JOIN periode per ON l.id_periode = per.periode_id
            LEFT JOIN jenis_ptm jp ON l.id_jenis_ptm = jp.id_jenis_ptm
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

        const resJenisPtm = await pool.query(
            'SELECT id_jenis_ptm, nama_ptm FROM jenis_ptm ORDER BY nama_ptm'
        );

        res.render('ptm/laporanptm', {
            daftarLaporan: laporan.rows,
            periodeAda: periodeAda.rows,
            jenisPtmOptions: resJenisPtm.rows,
            active: 'laporan',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'pj_ptm'
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
        const tahun    = parseInt(laporan.periode_tahun);
        const bulan    = parseInt(laporan.periode_bulan);  // bulan laporan (1–12)
        const namaBulanLaporan = NAMA_BULAN[bulan - 1];
        const jenisPtmTerpilih = laporan.id_jenis_ptm || 'hipertensi';

        // Ambil nama PTM
        const activePtmRes = await pool.query('SELECT nama_ptm FROM jenis_ptm WHERE id_jenis_ptm = $1', [jenisPtmTerpilih]);
        const namaPtm = activePtmRes.rows.length > 0 ? activePtmRes.rows[0].nama_ptm : 'Hipertensi';
        const namaFile = `Kohort_${namaPtm.replace(/\s+/g, '_')}_s.d_${namaBulanLaporan}_${tahun}.xlsx`;

        // 2. Ambil skrining pasien dari Januari s.d. bulan laporan pada tahun tersebut
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
                s.gula_darah,
                dmt.jenis_pemeriksaan AS dm_jenis_periksa,
                dmt.kategori_hasil AS dm_kategori,
                obt.imt,
                obt.berat_badan,
                obt.tinggi_badan,
                obt.kategori_obesitas,
                obt.lingkar_perut,
                ppt.skor_total AS ppok_skor,
                ppt.kategori_risiko AS ppok_risiko,
                git.hasil_pemeriksaan_mata,
                git.hasil_pemeriksaan_telinga,
                kjt.skor_total AS jiwa_skor,
                kjt.kategori_hasil AS jiwa_kategori,
                s.edukasi,
                s.dapat_obat,
                s.status_rujukan,
                s.merokok,
                s.aktivitas_fisik
            FROM skrining s
            JOIN pasien   p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong   j ON p.id_jorong   = j.id_jorong
            JOIN nagari   n ON j.id_nagari   = n.id_nagari
            LEFT JOIN skrining_hipertensi hp ON hp.id_skrining = s.id_skrining
            LEFT JOIN skrining_dm dmt ON dmt.id_skrining = s.id_skrining
            LEFT JOIN skrining_obesitas obt ON obt.id_skrining = s.id_skrining
            LEFT JOIN skrining_ppok ppt ON ppt.id_skrining = s.id_skrining
            LEFT JOIN skrining_gangguan_indra git ON git.id_skrining = s.id_skrining
            LEFT JOIN skrining_kesehatan_jiwa kjt ON kjt.id_skrining = s.id_skrining
            WHERE EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
              AND EXTRACT(MONTH FROM k.tanggal_kegiatan) <= $2
              AND s.status_validasi = 'terverifikasi'
              AND s.id_jenis_ptm = $3
            ORDER BY p.nama_pasien ASC, bulan ASC
        `, [tahun, bulan, jenisPtmTerpilih]);

        // 3. Ambil info bulan pertama kasus ditemukan per pasien (s.d. bulan laporan)
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
              AND s.id_jenis_ptm = $3
            GROUP BY p.id_pasien, EXTRACT(YEAR FROM k.tanggal_kegiatan)
            HAVING EXTRACT(YEAR FROM k.tanggal_kegiatan) = $1
               AND MIN(EXTRACT(MONTH FROM k.tanggal_kegiatan)) <= $2
        `, [tahun, bulan, jenisPtmTerpilih]);

        const kasusMap = {};
        kasusRes.rows.forEach(r => {
            kasusMap[r.id_pasien] = {
                bulan_pertama: r.bulan_pertama,
                kategori: r.kategori_kasus
            };
        });

        // 4. Susun data per pasien
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

            let statusText = 'NORMAL';
            if (jenisPtmTerpilih === 'dm') {
                const gd = parseInt(row.gula_darah) || 0;
                const jp = row.dm_jenis_periksa || 'Sewaktu';
                if (jp === 'Puasa' ? gd > 180 : gd > 200) {
                    statusText = 'DIABETES MELITUS';
                }
            } else if (jenisPtmTerpilih === 'obesitas') {
                const imt = parseFloat(row.imt) || 0;
                const kat = row.kategori_obesitas || 'Normal';
                if (kat === 'Obesitas' || kat === 'Overweight' || imt >= 25) {
                    statusText = 'OBESITAS';
                }
            } else if (jenisPtmTerpilih === 'ppok') {
                const skor = parseInt(row.ppok_skor) || 0;
                const ris = row.ppok_risiko || 'Rendah';
                if (ris === 'Tinggi' || skor >= 4) {
                    statusText = 'RISIKO PPOK';
                }
            } else if (jenisPtmTerpilih === 'gangguan_indra') {
                const mata = row.hasil_pemeriksaan_mata || 'Normal';
                const tel = row.hasil_pemeriksaan_telinga || 'Normal';
                if (mata !== 'Normal' || tel !== 'Normal') {
                    statusText = 'GANGGUAN INDRA';
                }
            } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
                const skor = parseInt(row.jiwa_skor) || 0;
                const kat = row.jiwa_kategori || 'Normal';
                if (kat !== 'Normal' || skor >= 6) {
                    statusText = 'RISIKO GANGGUAN JIWA';
                }
            } else { // hipertensi
                const sistole = parseInt(row.sistole) || 0;
                const diastole = parseInt(row.diastole) || 0;
                if (sistole >= 140 || diastole >= 90) {
                    statusText = 'HIPERTENSI';
                }
            }

            pasien.bulan[row.bulan] = {
                sistole:    row.sistole,
                diastole:   row.diastole,
                gula_darah: row.gula_darah,
                dm_jenis_periksa: row.dm_jenis_periksa,
                bb:         row.berat_badan,
                tb:         row.tinggi_badan,
                imt:        row.imt,
                lingkar_perut: row.lingkar_perut,
                ppok_skor:  row.ppok_skor,
                ppok_risiko: row.ppok_risiko,
                hasil_pemeriksaan_mata: row.hasil_pemeriksaan_mata,
                hasil_pemeriksaan_telinga: row.hasil_pemeriksaan_telinga,
                jiwa_skor:  row.jiwa_skor,
                jiwa_kategori: row.jiwa_kategori,
                status:     statusText,
                merokok:    row.merokok ? 'Ya' : 'Tidak',
                aktivitas_fisik: row.aktivitas_fisik || '-',
                edukasi:    row.edukasi && row.edukasi.trim() !== '' ? 'Ada' : 'Tidak',
                dapat_obat: row.dapat_obat && row.dapat_obat !== 'tidak'
                                ? (row.dapat_obat === 'beli_sendiri'    ? 'Beli Sendiri'
                                :  row.dapat_obat === 'dari_puskesmas'  ? 'Puskesmas'
                                :  row.dapat_obat === 'dari_rumah_sakit'? 'Rumah Sakit'
                                : 'Ada')
                                : 'Tidak',
                rujuk:      row.status_rujukan && row.status_rujukan === 'iya' ? 'Iya' : 'Tidak',
            };
        });

        const daftarPasien = Array.from(pasienMap.values());

        // 5. Setup Workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SI-Posbindu PTM';
        workbook.created = new Date();
        const ws = workbook.addWorksheet(`KOHORT S.D ${namaBulanLaporan.toUpperCase()} ${tahun}`, {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });

        const BIRU_TUA   = 'FF1D4ED8';
        const BIRU       = 'FF2563EB';
        const BIRU_MUDA  = 'FFD1E8FF';
        const MERAH      = 'FFDC2626';
        const PUTIH      = 'FFFFFFFF';

        const TOTAL_COL = 9 + (6 * bulan);

        ws.mergeCells(1, 1, 1, TOTAL_COL);
        const judulCell = ws.getCell('A1');
        judulCell.value     = `FORMAT LAPORAN KOHORT ${namaPtm.toUpperCase()} JANUARI - ${namaBulanLaporan.toUpperCase()} ${tahun}`;
        judulCell.font      = { bold: true, size: 14, color: { argb: PUTIH }, name: 'Arial' };
        judulCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU_TUA } };
        judulCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 30;

        ws.mergeCells(2, 1, 2, TOTAL_COL);
        const infoCell = ws.getCell('A2');
        infoCell.value     = `Dicetak: ${new Date().toLocaleDateString('id-ID')} | Total Pasien: ${daftarPasien.length} | Total Skrining: ${laporan.total_skrining}`;
        infoCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU_MUDA } };
        infoCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(2).height = 18;

        const ID_HEADERS = [
            { label: 'NO', width: 5 }, { label: 'NAMA', width: 24 }, { label: 'BULAN KASUS', width: 14 },
            { label: 'KATEGORI', width: 13 }, { label: 'NIK', width: 18 }, { label: 'JK', width: 12 },
            { label: 'UMUR', width: 7 }, { label: 'JORONG', width: 14 }, { label: 'NAGARI', width: 14 }
        ];

        ID_HEADERS.forEach((h, i) => {
            ws.getColumn(i + 1).width = h.width;
            ws.mergeCells(4, i + 1, 5, i + 1);
            const cell = ws.getCell(4, i + 1);
            cell.value = h.label;
            cell.font  = { bold: true, size: 9, color: { argb: PUTIH }, name: 'Arial' };
            cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = { top: { style: 'thin', color: { argb: 'FFB0B0B0' } }, bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } }, left: { style: 'thin', color: { argb: 'FFB0B0B0' } }, right: { style: 'thin', color: { argb: 'FFB0B0B0' } } };
        });

        ws.getRow(4).height = 18;
        ws.getRow(5).height = 18;

        let subHeaders = ['Sistole', 'Diastole', 'Status TD', 'Edukasi', 'Dapat Obat', 'Rujuk'];
        if (jenisPtmTerpilih === 'dm') {
            subHeaders = ['Gd Sewaktu', 'Gd Puasa', 'Status GD', 'Edukasi', 'Dapat Obat', 'Rujuk'];
        } else if (jenisPtmTerpilih === 'obesitas') {
            subHeaders = ['BB (kg)', 'TB (cm)', 'IMT', 'Status Obes', 'Lingkar Perut', 'Rujuk'];
        } else if (jenisPtmTerpilih === 'ppok') {
            subHeaders = ['Skor', 'Status PPOK', 'Merokok', 'Aktivitas Fisik', 'Edukasi', 'Rujuk'];
        } else if (jenisPtmTerpilih === 'gangguan_indra') {
            subHeaders = ['Mata', 'Telinga', 'Status Indra', 'Merokok', 'Aktivitas Fisik', 'Rujuk'];
        } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
            subHeaders = ['Skor SRQ', 'Status Jiwa', 'Merokok', 'Aktivitas Fisik', 'Edukasi', 'Rujuk'];
        }

        for (let bln = 1; bln <= bulan; bln++) {
            const colIdx = 9 + ((bln - 1) * 6) + 1;
            ws.mergeCells(4, colIdx, 4, colIdx + 5);
            const cell = ws.getCell(4, colIdx);
            cell.value = NAMA_BULAN[bln - 1].toUpperCase();
            cell.font  = { bold: true, size: 9, color: { argb: PUTIH }, name: 'Arial' };
            cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D5C3A' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { top: { style: 'thin', color: { argb: 'FFB0B0B0' } }, bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } }, left: { style: 'medium', color: { argb: 'FFB0B0B0' } }, right: { style: 'medium', color: { argb: 'FFB0B0B0' } } };

            subHeaders.forEach((label, subIdx) => {
                const subCell = ws.getCell(5, colIdx + subIdx);
                subCell.value = label;
                subCell.font = { bold: true, size: 8, color: { argb: 'FF333333' }, name: 'Arial' };
                subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                subCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                subCell.border = { top: { style: 'thin', color: { argb: 'FFD0D0D0' } }, bottom: { style: 'medium', color: { argb: 'FFB0B0B0' } }, left: subIdx === 0 ? { style: 'medium', color: { argb: 'FFB0B0B0' } } : { style: 'thin', color: { argb: 'FFD0D0D0' } }, right: subIdx === 5 ? { style: 'medium', color: { argb: 'FFB0B0B0' } } : { style: 'thin', color: { argb: 'FFD0D0D0' } } };
                ws.getColumn(colIdx + subIdx).width = 9.5;
            });
        }

        daftarPasien.forEach((pasien, idx) => {
            const rowNum = 6 + idx;
            const identitas = [idx + 1, pasien.nama, pasien.bulan_kasus, pasien.kategori, pasien.nik, pasien.jk === 'L' ? 'Laki-Laki' : 'Perempuan', pasien.usia, pasien.jorong, pasien.nagari];
            identitas.forEach((val, i) => {
                const cell = ws.getCell(rowNum, i + 1);
                cell.value = val;
                cell.border = { top: { style: 'thin', color: { argb: 'FFCCCCCC' } }, bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } }, left: { style: 'thin', color: { argb: 'FFCCCCCC' } }, right: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
            });

            for (let bln = 1; bln <= bulan; bln++) {
                const startCol = 9 + ((bln - 1) * 6) + 1;
                const data = pasien.bulan[bln];
                let vals = ['', '', '', '', '', ''];
                if (data) {
                    if (jenisPtmTerpilih === 'dm') {
                        const gd = data.gula_darah || '';
                        const jp = data.dm_jenis_periksa || 'Sewaktu';
                        vals = [jp === 'Puasa' ? '' : gd, jp === 'Puasa' ? gd : '', data.status, data.edukasi, data.dapat_obat, data.rujuk];
                    } else if (jenisPtmTerpilih === 'obesitas') {
                        vals = [data.bb, data.tb, data.imt, data.status, data.lingkar_perut, data.rujuk];
                    } else if (jenisPtmTerpilih === 'ppok') {
                        vals = [data.ppok_skor, data.status, data.merokok, data.aktivitas_fisik, data.edukasi, data.rujuk];
                    } else if (jenisPtmTerpilih === 'gangguan_indra') {
                        vals = [data.hasil_pemeriksaan_mata, data.hasil_pemeriksaan_telinga, data.status, data.merokok, data.aktivitas_fisik, data.rujuk];
                    } else if (jenisPtmTerpilih === 'kesehatan_jiwa') {
                        vals = [data.jiwa_skor, data.status, data.merokok, data.aktivitas_fisik, data.edukasi, data.rujuk];
                    } else {
                        vals = [data.sistole, data.diastole, data.status, data.edukasi, data.dapat_obat, data.rujuk];
                    }
                }
                vals.forEach((val, subIdx) => {
                    const cell = ws.getCell(rowNum, startCol + subIdx);
                    cell.value = val || '';
                    if (subIdx === 2 && ['HIPERTENSI', 'DIABETES MELITUS', 'OBESITAS', 'RISIKO PPOK', 'GANGGUAN INDRA', 'RISIKO GANGGUAN JIWA'].includes(val)) cell.font = { bold: true, color: { argb: MERAH } };
                    cell.border = { top: { style: 'thin', color: { argb: 'FFCCCCCC' } }, bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } }, left: subIdx === 0 ? { style: 'medium', color: { argb: 'FFB0B0B0' } } : { style: 'thin', color: { argb: 'FFCCCCCC' } }, right: subIdx === 5 ? { style: 'medium', color: { argb: 'FFB0B0B0' } } : { style: 'thin', color: { argb: 'FFCCCCCC' } } };
                });
            }
        });

        const totalRow = 6 + daftarPasien.length;
        ws.mergeCells(totalRow, 1, totalRow, TOTAL_COL);
        const totalCell = ws.getCell(totalRow, 1);
        totalCell.value = `TOTAL PASIEN: ${daftarPasien.length} | TOTAL SKRINING: ${laporan.total_skrining}`;
        totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU_MUDA } };
        totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(totalRow).height = 18;

        ws.views = [{ state: 'frozen', xSplit: 9, ySplit: 5 }];

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${namaFile}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("Error export Excel:", err);
        res.status(500).send("Gagal mengunduh Excel: " + err.message);
    }
};