const pool = require('../config/db');
const ExcelJS = require('exceljs');

// 0. Tampilkan Halaman Dashboard (Wajib ada agar server tidak crash)
exports.renderDashboard = async (req, res) => {
    try {
        res.render('bidan/dashboard', {
            active: 'dashboard'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat dashboard bidan");
    }
};

// 1. Tampilkan Daftar Antrean Validasi
exports.renderValidasi = async (req, res) => {
    try {
        // Ambil data skrining yang statusnya 'menunggu'
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, k.tanggal_kegiatan, j.nama_jorong
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong j ON p.id_jorong = j.id_jorong
            WHERE s.status_validasi = 'menunggu'
            ORDER BY k.tanggal_kegiatan ASC
        `;
        const result = await pool.query(query);

        res.render('bidan/validasi', {
            menungguValidasi: result.rows,
            active: 'validasi' // Untuk penanda menu aktif di sidebar
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat antrean validasi");
    }
};

// 2. Proses Action Validasi (Terima / Revisi)
exports.handleActionValidasi = async (req, res) => {
    const { id_skrining } = req.params;
    const { status_validasi, catatan_bidan } = req.body; 

    try {
        const query = `
            UPDATE skrining 
            SET status_validasi = $1, catatan_bidan = $2 
            WHERE id_skrining = $3
        `;
        await pool.query(query, [status_validasi, catatan_bidan, id_skrining]);
        
        res.redirect('/bidan/validasi'); // Refresh halaman setelah divalidasi
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memproses validasi");
    }
};

// 3. Tampilkan Halaman Laporan
exports.renderLaporan = async (req, res) => {
    try {
        // Ambil data skrining yang sudah 'diterima' oleh bidan
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, j.nama_jorong, k.tanggal_kegiatan 
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong j ON p.id_jorong = j.id_jorong
            WHERE s.status_validasi = 'diterima'
            ORDER BY k.tanggal_kegiatan DESC
        `;
        const result = await pool.query(query);

        res.render('bidan/laporan', {
            laporanData: result.rows,
            active: 'laporan' // Untuk highlight menu sidebar
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal memuat halaman laporan");
    }
};

// 4. Proses Export Data ke Excel
exports.exportLaporanExcel = async (req, res) => {
    try {
        const query = `
            SELECT s.*, p.nama_pasien, p.nik, j.nama_jorong, k.tanggal_kegiatan 
            FROM skrining s
            JOIN pasien p ON s.id_pasien = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong j ON p.id_jorong = j.id_jorong
            WHERE s.status_validasi = 'diterima'
            ORDER BY k.tanggal_kegiatan ASC
        `;
        const result = await pool.query(query);

        // Buat file Excel Baru
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Posbindu');

        // Buat Header Kolom
        worksheet.columns = [
            { header: 'No', key: 'no', width: 5 },
            { header: 'Tanggal', key: 'tanggal', width: 15 },
            { header: 'Nama Pasien', key: 'nama_pasien', width: 25 },
            { header: 'NIK', key: 'nik', width: 20 },
            { header: 'Jorong', key: 'jorong', width: 20 },
            { header: 'Tensi (S/D)', key: 'tensi', width: 15 },
            { header: 'Status Tekanan', key: 'status', width: 20 },
            { header: 'Berat (kg)', key: 'bb', width: 10 },
            { header: 'Tinggi (cm)', key: 'tb', width: 10 },
            { header: 'Gula Darah', key: 'gula', width: 15 },
        ];

        // Memasukkan data dari database ke Excel
        result.rows.forEach((row, index) => {
            worksheet.addRow({
                no: index + 1,
                tanggal: new Date(row.tanggal_kegiatan).toLocaleDateString('id-ID'),
                nama_pasien: row.nama_pasien,
                nik: row.nik,
                jorong: row.nama_jorong,
                tensi: `${row.sistole}/${row.diastole}`,
                status: row.status_tekanan,
                bb: row.berat_badan || '-',
                tb: row.tinggi_badan || '-',
                gula: row.gula_darah || '-'
            });
        });

        // Styling Header Excel (Tebal & Warna Latar)
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{ argb:'FF2563EB' } };

        // Konfigurasi Response untuk Download File
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=' + 'Laporan_Posbindu.xlsx');

        // Kirim file ke browser
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal mengekspor laporan");
    }
};