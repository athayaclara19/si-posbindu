const pool    = require('../config/db');
const ExcelJS = require('exceljs');
 
// 1. Dashboard Bidan
exports.renderDashboard = async (req, res) => {
    try {
        const menunggu      = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='menunggu'");
        const terverifikasi = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='terverifikasi'");
        // FIX: gunakan 'revisi' bukan 'ditolak' — konsisten dengan kaderControllers.js
        const ditolak       = await pool.query("SELECT COUNT(*) FROM skrining WHERE status_validasi='revisi'");
        
        const jumlahMenunggu      = parseInt(menunggu.rows[0].count) || 0;
        const jumlahTerverifikasi = parseInt(terverifikasi.rows[0].count) || 0;
        const jumlahDitolak       = parseInt(ditolak.rows[0].count) || 0;
        const totalData           = jumlahMenunggu + jumlahTerverifikasi + jumlahDitolak;

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

        // FIX: tambahkan currentUser dan role agar header tidak error
        res.render('bidan/dashboardbidan', {
            active: 'dashboard',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'bidan',
            totalData,
            jumlahMenunggu,
            jumlahTerverifikasi,
            jumlahDitolak,
            antreanValidasi: antreanResult.rows,
            jorongStats: jorongStats.rows,
            tensiStats: tensiStats.rows[0],
            successMessage: req.session.successMessage || null,
            errorMessage:   req.session.errorMessage   || null,
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;
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
        
        const id_validator = req.session.user ? req.session.user.id_user : null;

        // FIX: 'revisi' disimpan sebagai 'revisi' (bukan 'ditolak')
        // agar konsisten dengan query di kaderControllers.js
        const statusMap = {
            'terverifikasi': 'terverifikasi',
            'Valid':         'terverifikasi',
            'revisi':        'revisi',
            'ditolak':       'revisi',
        };

        const finalStatus = statusMap[status_validasi] || null;

        if (!finalStatus) {
            return res.status(400).send(`Status validasi tidak valid: "${status_validasi}".`);
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
        // --- Ambil parameter pencarian, filter, & pagination dari query string ---
        const search       = (req.query.search || '').trim();
        const jorongFilter = (req.query.jorong || '').trim();   // id_jorong
        const statusFilter = (req.query.status || '').trim();   // normal | pra | ht1 | ht2 | krisis
        const page         = Math.max(1, parseInt(req.query.page) || 1);
        const limit         = 20;
        const offset         = (page - 1) * limit;

        // --- Bangun kondisi WHERE secara dinamis ---
        const conditions  = [`s.status_validasi = 'terverifikasi'`];
        const queryParams = [];

        if (search !== '') {
            queryParams.push(`%${search}%`);
            conditions.push(`(p.nama_pasien ILIKE $${queryParams.length} OR p.nik ILIKE $${queryParams.length})`);
        }
        if (jorongFilter !== '') {
            queryParams.push(jorongFilter);
            conditions.push(`p.id_jorong = $${queryParams.length}`);
        }
        if (statusFilter !== '') {
            const bucketMap = {
                normal: 's.sistole < 120',
                pra:    's.sistole >= 120 AND s.sistole < 140',
                ht1:    's.sistole >= 140 AND s.sistole < 160',
                ht2:    's.sistole >= 160 AND s.sistole < 180',
                krisis: 's.sistole >= 180',
            };
            if (bucketMap[statusFilter]) conditions.push(bucketMap[statusFilter]);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        // --- Hitung total data (untuk pagination) ---
        const countQuery = `
            SELECT COUNT(*)
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const totalData   = parseInt(countResult.rows[0].count);
        const totalPages  = Math.max(1, Math.ceil(totalData / limit));

        // --- Query data dengan LIMIT/OFFSET ---
        const limitIdx  = queryParams.length + 1;
        const offsetIdx = queryParams.length + 2;
        const dataParams = [...queryParams, limit, offset];

        const query = `
            SELECT s.*, p.nama_pasien, p.nik, j.nama_jorong, k.tanggal_kegiatan
            FROM skrining s
            JOIN pasien  p ON s.id_pasien   = p.id_pasien
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            JOIN jorong  j ON p.id_jorong   = j.id_jorong
            ${whereClause}
            ORDER BY k.tanggal_kegiatan DESC
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;
        const result = await pool.query(query, dataParams);

        // --- Data jorong untuk dropdown filter ---
        const jorong = await pool.query('SELECT id_jorong, nama_jorong FROM jorong ORDER BY nama_jorong ASC');

        res.render('bidan/laporan', {
            laporanData: result.rows,
            jorong: jorong.rows,
            active: 'laporan',
            currentUser: req.session.user || null,
            role: req.session.user ? req.session.user.role : 'bidan',
            // Data pencarian, filter & pagination untuk view
            search,
            selectedJorong: jorongFilter,
            selectedStatus: statusFilter,
            page,
            totalPages,
            totalData,
            limit,
        });
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
