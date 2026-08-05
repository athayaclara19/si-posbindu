const pool = require('../src/config/db');

(async () => {
  try {
    const userRes = await pool.query("SELECT id_user FROM \"user\" WHERE username = 'kader_ani'");
    const id_user = userRes.rows[0].id_user;
    
    const countResult = await pool.query(
        `SELECT COUNT(DISTINCT s.id_pasien) 
         FROM skrining s
         JOIN pasien p ON s.id_pasien = p.id_pasien
         WHERE s.id_kader = $1`, [id_user]);
    const totalData = parseInt(countResult.rows[0].count);
    console.log(`totalData: ${totalData}`);

    const patientIdsResult = await pool.query(`
        SELECT s.id_pasien, MAX(k.tanggal_kegiatan) AS max_date
        FROM skrining s
        JOIN pasien p ON s.id_pasien = p.id_pasien
        JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
        WHERE s.id_kader = $1
        GROUP BY s.id_pasien
        ORDER BY max_date DESC
    `, [id_user]);
    const patientIds = patientIdsResult.rows.map(r => r.id_pasien);

    const dataQuery = `
        SELECT p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong,
               json_agg(json_build_object(
                   'id_kegiatan', sub.id_kegiatan,
                   'tanggal_kegiatan', sub.tanggal_kegiatan,
                   'pemeriksaan', sub.pemeriksaan
               ) ORDER BY sub.tanggal_kegiatan DESC) AS kunjungan
        FROM (
            SELECT s.id_pasien, s.id_kegiatan, k.tanggal_kegiatan,
                   json_agg(json_build_object(
                       'id_skrining', s.id_skrining,
                       'id_jenis_ptm', s.id_jenis_ptm,
                       'nama_ptm', jp.nama_ptm,
                       'status_validasi', s.status_validasi,
                       'catatan_bidan', s.catatan_bidan
                   )) AS pemeriksaan
            FROM skrining s
            JOIN kegiatan k ON s.id_kegiatan = k.id_kegiatan
            LEFT JOIN jenis_ptm jp ON s.id_jenis_ptm = jp.id_jenis_ptm
            WHERE s.id_kader = $1
            GROUP BY s.id_pasien, s.id_kegiatan, k.tanggal_kegiatan
        ) sub
        JOIN pasien p ON sub.id_pasien = p.id_pasien
        JOIN jorong j ON p.id_jorong = j.id_jorong
        WHERE p.id_pasien = ANY($2)
        GROUP BY p.id_pasien, p.nama_pasien, p.nik, j.nama_jorong
        ORDER BY MAX(sub.tanggal_kegiatan) DESC
    `;
    const dataResult = await pool.query(dataQuery, [id_user, patientIds]);
    console.log(`Query returned ${dataResult.rows.length} rows.`);
    dataResult.rows.forEach(r => {
        if (!r.kunjungan) {
            console.log(`Patient ${r.nama_pasien} (ID: ${r.id_pasien}) has no kunjungan!`);
        } else {
            console.log(`Patient ${r.nama_pasien} has ${r.kunjungan.length} kunjungan.`);
        }
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
