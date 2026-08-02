const pool = require('../config/db');

// ─────────────────────────────────────────────
// 1. Tampilkan Halaman Kelola Target
// ─────────────────────────────────────────────
exports.renderKelolaTarget = async (req, res) => {
    try {
        const tahunIni = new Date().getFullYear();

        // Ambil semua nagari aktif
        const resNagari = await pool.query(
            `SELECT id_nagari, nama_nagari FROM nagari WHERE is_active = true ORDER BY nama_nagari`
        );

        // Ambil daftar tahun yang sudah ada target globalnya
        const resTahun = await pool.query(
            `SELECT DISTINCT tahun FROM target_tahunan ORDER BY tahun DESC`
        );

        // Ambil daftar jenis PTM
        const resJenisPtm = await pool.query(
            `SELECT id_jenis_ptm, nama_ptm FROM jenis_ptm ORDER BY nama_ptm`
        );

        // Ambil target per nagari untuk tahun & jenis PTM yang dipilih (default tahun ini & hipertensi)
        const tahunDipilih = parseInt(req.query.tahun) || tahunIni;
        const jenisPtmTerpilih = req.query.jenis_ptm || 'hipertensi';

        const resTarget = await pool.query(
            `SELECT tt.id_target, tt.id_nagari, tt.tahun, tt.target_total, tt.catatan,
                    n.nama_nagari, tt.id_jenis_ptm
             FROM target_tahunan tt
             JOIN nagari n ON tt.id_nagari = n.id_nagari
             WHERE tt.tahun = $1 AND tt.id_jenis_ptm = $2
             ORDER BY n.nama_nagari`,
            [tahunDipilih, jenisPtmTerpilih]
        );

        // Hitung target global (jumlah semua target nagari di tahun itu)
        const targetGlobal = resTarget.rows.reduce((sum, r) => sum + r.target_total, 0);

        res.render('ptm/kelolatarget', {
            active: 'target',
            currentUser:    req.session.user || null,
            nagariList:     resNagari.rows,
            tahunList:      resTahun.rows,
            jenisPtmList:   resJenisPtm.rows,
            targetPerNagari: resTarget.rows,
            targetGlobal,
            tahunDipilih,
            tahunIni,
            jenisPtmTerpilih,
            successMessage: req.session.successMessage || null,
            errorMessage:   req.session.errorMessage   || null,
        });

        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('ERROR RENDER KELOLA TARGET:', err);
        res.status(500).send('Gagal memuat halaman kelola target.');
    }
};

// ─────────────────────────────────────────────
// 2. Simpan Target Global → Bagi Rata ke Nagari
// ─────────────────────────────────────────────
exports.handleSimpanTargetGlobal = async (req, res) => {
    const { tahun, target_global, catatan, id_jenis_ptm } = req.body;
    const ptmType = id_jenis_ptm || 'hipertensi';

    try {
        if (!tahun || !target_global || isNaN(tahun) || isNaN(target_global)) {
            req.session.errorMessage = 'Tahun dan target global harus diisi dengan angka yang valid.';
            return res.redirect(`/ptm/target?jenis_ptm=${ptmType}`);
        }
        if (parseInt(target_global) <= 0) {
            req.session.errorMessage = 'Target global harus lebih dari 0.';
            return res.redirect(`/ptm/target?jenis_ptm=${ptmType}`);
        }

        const totalTarget = parseInt(target_global);
        const tahunInt    = parseInt(tahun);

        // Ambil semua nagari aktif
        const resNagari = await pool.query(
            `SELECT id_nagari FROM nagari WHERE is_active = true ORDER BY id_nagari`
        );
        const nagariList = resNagari.rows;
        const jumlahNagari = nagariList.length;

        if (jumlahNagari === 0) {
            req.session.errorMessage = 'Tidak ada nagari aktif di sistem.';
            return res.redirect(`/ptm/target?jenis_ptm=${ptmType}`);
        }

        // Hitung pembagian rata, sisa ke nagari pertama
        const targetPerNagari = Math.floor(totalTarget / jumlahNagari);
        const sisa = totalTarget - (targetPerNagari * jumlahNagari);

        // Upsert target untuk tiap nagari
        for (let i = 0; i < nagariList.length; i++) {
            const { id_nagari } = nagariList[i];
            const targetNagari = i === 0 ? targetPerNagari + sisa : targetPerNagari;

            await pool.query(`
                INSERT INTO target_tahunan (id_nagari, tahun, target_total, catatan, id_jenis_ptm, dibuat_pada, diubah_pada)
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                ON CONFLICT (id_nagari, tahun, id_jenis_ptm)
                DO UPDATE SET
                    target_total = EXCLUDED.target_total,
                    catatan      = EXCLUDED.catatan,
                    diubah_pada  = NOW()
            `, [id_nagari, tahunInt, targetNagari, catatan || null, ptmType]);
        }

        req.session.successMessage = `Target global ${totalTarget.toLocaleString('id-ID')} berhasil dibagi ke ${jumlahNagari} nagari untuk tahun ${tahun}.`;
        res.redirect(`/ptm/target?tahun=${tahunInt}&jenis_ptm=${ptmType}`);

    } catch (err) {
        console.error('ERROR SIMPAN TARGET GLOBAL:', err);
        req.session.errorMessage = 'Gagal menyimpan target. Terjadi kesalahan sistem.';
        res.redirect(`/ptm/target?jenis_ptm=${ptmType}`);
    }
};

// ─────────────────────────────────────────────
// 3. Edit Target Per Nagari (satu nagari)
// ─────────────────────────────────────────────
exports.handleEditTargetNagari = async (req, res) => {
    const { id_target, target_total, catatan, tahun, id_jenis_ptm } = req.body;
    const ptmType = id_jenis_ptm || 'hipertensi';

    try {
        if (!target_total || isNaN(target_total) || parseInt(target_total) <= 0) {
            req.session.errorMessage = 'Target harus diisi dengan angka lebih dari 0.';
            return res.redirect(`/ptm/target?tahun=${tahun}&jenis_ptm=${ptmType}`);
        }

        await pool.query(`
            UPDATE target_tahunan
            SET target_total = $1, catatan = $2, diubah_pada = NOW()
            WHERE id_target = $3
        `, [parseInt(target_total), catatan || null, parseInt(id_target)]);

        req.session.successMessage = 'Target nagari berhasil diperbarui.';
        res.redirect(`/ptm/target?tahun=${tahun}&jenis_ptm=${ptmType}`);

    } catch (err) {
        console.error('ERROR EDIT TARGET NAGARI:', err);
        req.session.errorMessage = 'Gagal memperbarui target nagari.';
        res.redirect(`/ptm/target?tahun=${tahun}&jenis_ptm=${ptmType}`);
    }
};

// ─────────────────────────────────────────────
// 4. Hapus Target Seluruh Nagari untuk 1 Tahun & Jenis PTM
// ─────────────────────────────────────────────
exports.handleHapusTarget = async (req, res) => {
    const { tahun } = req.params;
    const { jenis_ptm } = req.query;
    const ptmType = jenis_ptm || 'hipertensi';

    try {
        await pool.query(
            'DELETE FROM target_tahunan WHERE tahun = $1 AND id_jenis_ptm = $2',
            [parseInt(tahun), ptmType]
        );
        req.session.successMessage = `Target tahun ${tahun} berhasil dihapus.`;
        res.redirect(`/ptm/target?jenis_ptm=${ptmType}`);
    } catch (err) {
        console.error('ERROR HAPUS TARGET:', err);
        req.session.errorMessage = 'Gagal menghapus target.';
        res.redirect(`/ptm/target?jenis_ptm=${ptmType}`);
    }
};

// ─────────────────────────────────────────────
// 5. Helper: Ambil target total untuk tahun tertentu & jenis PTM
// ─────────────────────────────────────────────
exports.getTargetByTahun = async (tahun, id_jenis_ptm = 'hipertensi') => {
    const result = await pool.query(
        'SELECT SUM(target_total) as total FROM target_tahunan WHERE tahun = $1 AND id_jenis_ptm = $2',
        [tahun, id_jenis_ptm]
    );
    return result.rows[0]?.total ? parseInt(result.rows[0].total) : 2000;
};