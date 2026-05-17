const pool    = require('../config/db');
const ExcelJS = require('exceljs');
 
// 1. Dashboard Bidan
// 1. Dashboard Bidan
exports.renderDashboard = async (req, res) => {
    try {
        // A. Hitung metrik card atas
        const menunggu      = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='menunggu'");
        const terverifikasi = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='terverifikasi'");
        const ditolak       = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='ditolak'");
        
        const jumlahMenunggu      = parseInt(menunggu.rows[0].count) || 0;
        const jumlahTerverifikasi = parseInt(terverifikasi.rows[0].count) || 0;
        const jumlahDitolak       = parseInt(ditolak.rows[0].count) || 0;
        const totalData           = jumlahMenunggu + jumlahTerverifikasi + jumlahDitolak;

        // B. Ambil 3 data antrean terbaru untuk list "Data Belum Diverifikasi"
        const queryAntrean = `
            SELECT s.*, p.nama_pasien, p.nik, k.tanggal_kegiatan, j.nama_jorong
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            WHERE s.status_validasi = 'menunggu'
            ORDER BY k.tanggal_kegiatan ASC
            LIMIT 3
        `;
        const antreanResult = await pool.query(queryAntrean);

        // C. Ambil statistik per Jorong untuk Chart dan List
        const queryJorong = `
            SELECT 
                j.nama_jorong, 
                COUNT(s.id_skrining) as total_pasien,
                COUNT(CASE WHEN s.sistole >= 140 THEN 1 END) as hipertensi,
                COUNT(CASE WHEN s.status_validasi = 'menunggu' THEN 1 END) as menunggu
            FROM jorong j
            LEFT JOIN pasien p ON j.id_jorong = p.id_jorong
            LEFT JOIN skrining s ON p.id_pasien = s.id_pasien
            GROUP BY j.nama_jorong
            ORDER BY j.nama_jorong
        `;
        const jorongStats = await pool.query(queryJorong);

        // D. Ambil statistik Tensi Darah untuk progress bar
        const queryTensi = `
            SELECT 
                COUNT(CASE WHEN sistole < 120 THEN 1 END) as normal,
                COUNT(CASE WHEN sistole >= 120 AND sistole < 140 THEN 1 END) as terkendali,
                COUNT(CASE WHEN sistole >= 140 THEN 1 END) as hipertensi,
                COUNT(id_skrining) as total
            FROM skrining
            WHERE sistole IS NOT NULL
        `;
        const tensiStats = await pool.query(queryTensi);

        // Kirim semua data ke EJS
        res.render('bidan/dashboardbidan', {
            active: 'dashboard',
            totalData,
            jumlahMenunggu,
            jumlahTerverifikasi,
            jumlahDitolak,
            antreanValidasi: antreanResult.rows,
            jorongStats: jorongStats.rows,
            tensiStats: tensiStats.rows[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat dashboard bidan.");
    }
};
 
// 2. Daftar Antrean Validasi
exports.renderValidasi = async (req, res) => {
    try {
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, k.tanggal_kegiatan, j.nama_jorong
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            WHERE s.status_validasi = 'menunggu'
            ORDER BY k.tanggal_kegiatan ASC
        `;
        const result = await pool.query(query);
        res.render('bidan/validasi', {
            menungguValidasi: result.rows,
            active: 'validasi',
            currentUser: req.session.user || null,  
            role: req.session.user ? req.session.user.role : 'bidan'  
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat antrean validasi.");
    }
};
 
// 3. Proses Validasi (Terima / Tolak)
exports.handleActionValidasi = async (req, res) => {
    try {
        const { id_skrining } = req.params;
        const { status_validasi, catatan_bidan } = req.body;
        
        // Mengambil id user dengan aman (mencegah crash jika session hilang)
        const id_validator = req.session.user ? req.session.user.id_user : null;

        // Mapping status dari form ke nilai enum yang valid di database:
        // 'terverifikasi' -> diterima bidan
        // 'ditolak'       -> dikembalikan / revisi ke kader
        const statusMap = {
            'terverifikasi': 'terverifikasi',
            'Valid':         'terverifikasi',
            'revisi':        'ditolak',
            'ditolak':       'ditolak',
        };

        const finalStatus = statusMap[status_validasi] || null;

        if (!finalStatus) {
            return res.status(400).send(`Status validasi tidak valid: "${status_validasi}". Nilai yang diizinkan: terverifikasi, ditolak.`);
        }

        const query = `
            UPDATE skrining
            SET status_validasi=$1, catatan_bidan=$2,
                id_validator=$3, tanggal_validasi=NOW()
            WHERE id_skrining=$4
        `;
        
        await pool.query(query, [finalStatus, catatan_bidan || null, id_validator, id_skrining]);
        
        res.redirect('/bidan/validasi');

    } catch (err) {
        console.error("ERROR SAAT VALIDASI:", err);
        res.status(500).send("Gagal memproses validasi. Penyebab: " + err.message);
    }
};
 
// 4. Halaman Laporan Bidan
exports.renderLaporan = async (req, res) => {
    try {
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, j.nama_jorong, k.tanggal_kegiatan
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            WHERE s.status_validasi = 'terverifikasi'
            ORDER BY k.tanggal_kegiatan DESC
        `;
        const result = await pool.query(query);
        res.render('bidan/laporan', { laporanData: result.rows, active: 'laporan' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat laporan.");
    }
};
 
// 5. Export Excel
exports.exportLaporanExcel = async (req, res) => {
    try {
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, j.nama_jorong, k.tanggal_kegiatan
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            WHERE s.status_validasi = 'terverifikasi'
            ORDER BY k.tanggal_kegiatan ASC
        `;
        const result = await pool.query(query);
        const workbook  = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Posbindu');
        worksheet.columns = [
            { header:'No',          key:'no',         width:5  },
            { header:'Tanggal',     key:'tanggal',    width:15 },
            { header:'Nama Pasien', key:'nama_pasien',width:25 },
            { header:'NIK',         key:'nik',        width:20 },
            { header:'Jorong',      key:'jorong',     width:20 },
            { header:'Tensi (S/D)', key:'tensi',      width:15 },
            { header:'BB (kg)',     key:'bb',         width:10 },
            { header:'TB (cm)',     key:'tb',         width:10 },
            { header:'Gula Darah',  key:'gula',       width:15 },
            { header:'Status',      key:'status',     width:20 },
        ];
        result.rows.forEach((row, i) => {
            let status = 'Normal';
            if (row.sistole >= 180) status = 'Krisis';
            else if (row.sistole >= 160) status = 'HT Tkt.2';
            else if (row.sistole >= 140) status = 'HT Tkt.1';
            else if (row.sistole >= 120) status = 'Pra-HT';
            worksheet.addRow({
                no: i+1,
                tanggal: new Date(row.tanggal_kegiatan).toLocaleDateString('id-ID'),
                nama_pasien: row.nama_pasien, nik: row.nik, jorong: row.nama_jorong,
                tensi: `${row.sistole}/${row.diastole}`,
                bb: row.berat_badan||'-', tb: row.tinggi_badan||'-',
                gula: row.gula_darah||'-', status
            });
        });
        worksheet.getRow(1).font = { bold:true, color:{argb:'FFFFFFFF'} };
        worksheet.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2563EB'} };
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename=Laporan_Posbindu.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal mengekspor laporan: " + err.message);
    }
};
