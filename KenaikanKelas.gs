// KenaikanKelas.gs — Phase 6 (inti). Superadmin only, selalu per sekolah
// (tidak pernah global/lintas sekolah). Mapping kelas lama→kelas
// tujuan/ALUMNI dikonfigurasi bebas oleh Superadmin (TIDAK diasumsikan
// 7A→8A dst.) — sekolah bisa redistribusi siswa sesuai kebijakannya.
//
// Non-destruktif secara ketat: baris RIWAYAT_KELAS lama TIDAK PERNAH
// diubah/dihapus — proses ini cuma menambah baris baru untuk tahun
// ajaran baru. "Tinggal kelas" ditangani dengan MENGECUALIKAN siswa itu
// dari batch kenaikan (Superadmin urus manual lewat "Kelola Siswa per
// Kelas" yang sudah ada — tidak perlu logika/endpoint baru untuk itu).
//
// Siswa baru intake & mutasi keluar SUDAH ditangani modul Siswa.gs
// (Import Siswa massal + field status PINDAH_KELUAR) — tidak diulang di
// sini. Mutasi masuk berdokumen lengkap (asal sekolah, nilai rapor
// terakhir) BELUM dibangun — itu perluasan lanjutan, bukan bagian
// minimum kenaikan kelas.

/**
 * KenaikanKelas_computePlan_(sekolahId, tahunAjaranLamaId, tahunAjaranBaruId, mapping)
 * mapping: [{kelas_lama_id, kelas_tujuan_id}] — kelas_tujuan_id boleh
 * kelas_id biasa, atau string khusus 'LULUS' (siswa jadi ALUMNI).
 * Hitung saja, TIDAK menulis apa pun — dipakai untuk preview
 * (adminPreviewKenaikanKelas) maupun sesaat sebelum eksekusi nyata
 * (adminExecuteKenaikanKelas), supaya preview = persis yang dieksekusi.
 */
function KenaikanKelas_computePlan_(sekolahId, tahunAjaranLamaId, tahunAjaranBaruId, mapping) {
  sekolahId = String(sekolahId || '').trim();
  tahunAjaranLamaId = String(tahunAjaranLamaId || '').trim();
  tahunAjaranBaruId = String(tahunAjaranBaruId || '').trim();
  if (!sekolahId || !tahunAjaranLamaId || !tahunAjaranBaruId) throw new Error('Sekolah, tahun ajaran lama, dan tahun ajaran baru wajib diisi.');
  if (tahunAjaranLamaId === tahunAjaranBaruId) throw new Error('Tahun ajaran lama dan tahun ajaran baru harus berbeda.');
  const rows = Array.isArray(mapping) ? mapping : [];
  if (!rows.length) throw new Error('Tambah minimal satu pemetaan kelas.');
  const semesterBaru = TahunAjaran_getSemester_(tahunAjaranBaruId);

  const kelasById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')), 'kelas_id');
  const siswaById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_SISWA')), 'siswa_id');
  const riwayat = Utils_sheetToObjects_(Config_getSheet_('RIWAYAT_KELAS'));

  const planMapping = rows.map(function (m) {
    const kelasLamaId = String(m.kelas_lama_id || '').trim();
    const kelasTujuanId = String(m.kelas_tujuan_id || '').trim();
    if (!kelasLamaId || !kelasTujuanId) throw new Error('Ada baris pemetaan kelas yang belum lengkap.');
    const isLulus = kelasTujuanId === 'LULUS';
    if (!isLulus && !kelasById[kelasTujuanId]) throw new Error('Kelas tujuan tidak ditemukan.');

    const siswa = riwayat.filter(function (r) {
      return r.kelas_id === kelasLamaId && r.tahun_ajaran_id === tahunAjaranLamaId &&
        String(r.status).toUpperCase() === 'AKTIF';
    }).map(function (r) {
      const s = siswaById[r.siswa_id] || {};
      return { siswa_id: r.siswa_id, nama_lengkap: s.nama_lengkap || '(tidak ditemukan)', nis: s.nis || '' };
    });

    return {
      kelas_lama_id: kelasLamaId,
      nama_kelas_lama: (kelasById[kelasLamaId] || {}).nama_kelas || kelasLamaId,
      kelas_tujuan_id: isLulus ? 'LULUS' : kelasTujuanId,
      nama_kelas_tujuan: isLulus ? 'LULUS / ALUMNI' : ((kelasById[kelasTujuanId] || {}).nama_kelas || kelasTujuanId),
      siswa: siswa
    };
  });

  return { sekolah_id: sekolahId, tahun_ajaran_lama_id: tahunAjaranLamaId, tahun_ajaran_baru_id: tahunAjaranBaruId, semester_baru: semesterBaru, mapping: planMapping };
}

function adminPreviewKenaikanKelas(sekolahId, tahunAjaranLamaId, tahunAjaranBaruId, mapping) {
  Security_requireRole_(['SUPERADMIN']);
  return KenaikanKelas_computePlan_(sekolahId, tahunAjaranLamaId, tahunAjaranBaruId, mapping);
}

/**
 * adminExecuteKenaikanKelas(sekolahId, tahunAjaranLamaId, tahunAjaranBaruId, mapping, excludedSiswaIds)
 * excludedSiswaIds: siswa yang DIKECUALIKAN dari batch ini (mis. tinggal
 * kelas) — tetap AKTIF di kelas lama, urus manual lewat "Kelola Siswa
 * per Kelas" kapan saja. Batch write: satu setValues untuk semua baris
 * RIWAYAT_KELAS baru, bukan satu appendRow per siswa.
 */
function adminExecuteKenaikanKelas(sekolahId, tahunAjaranLamaId, tahunAjaranBaruId, mapping, excludedSiswaIds) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const plan = KenaikanKelas_computePlan_(sekolahId, tahunAjaranLamaId, tahunAjaranBaruId, mapping);
  const excluded = {};
  (excludedSiswaIds || []).forEach(function (id) { excluded[id] = true; });

  const rkSh = Config_getSheet_('RIWAYAT_KELAS');
  const rkHeader = rkSh.getRange(1, 1, 1, rkSh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const now = new Date();
  const newRows = [];
  const affectedKelas = {};
  const alumniIds = {};
  let totalPromoted = 0, totalLulus = 0, totalExcluded = 0;

  plan.mapping.forEach(function (m) {
    const isLulus = m.kelas_tujuan_id === 'LULUS';
    m.siswa.forEach(function (s) {
      if (excluded[s.siswa_id]) { totalExcluded++; return; }
      const obj = {
        riwayat_id: Utils_newId_('RK'), siswa_id: s.siswa_id, sekolah_id: sekolahId,
        tahun_ajaran_id: tahunAjaranBaruId, semester: plan.semester_baru,
        kelas_id: isLulus ? m.kelas_lama_id : m.kelas_tujuan_id,
        status: isLulus ? 'ALUMNI' : 'NAIK_KELAS',
        tanggal_mulai: now, tanggal_selesai: '', keterangan: 'Kenaikan kelas dari ' + m.nama_kelas_lama
      };
      newRows.push(rkHeader.map(function (k) { return obj[k] === undefined ? '' : obj[k]; }));
      if (isLulus) { totalLulus++; alumniIds[s.siswa_id] = true; } else { totalPromoted++; affectedKelas[m.kelas_tujuan_id] = true; }
    });
  });

  if (!newRows.length) throw new Error('Tidak ada siswa yang diproses (semua dikecualikan, atau tidak ada siswa aktif di kelas-kelas itu).');

  const startRow = rkSh.getLastRow() + 1;
  rkSh.getRange(startRow, 1, newRows.length, rkHeader.length).setValues(newRows);

  if (Object.keys(alumniIds).length) KenaikanKelas_markAlumni_(Object.keys(alumniIds));

  const requestId = Utils_newId_('RKK');
  const notes = totalPromoted + ' naik kelas, ' + totalLulus + ' lulus/alumni, ' + totalExcluded + ' dikecualikan (tinggal kelas/manual)';
  Utils_appendRowByHeader_(Config_getSheet_('REQUEST_KENAIKAN_KELAS'), {
    request_id: requestId, sekolah_id: sekolahId,
    tahun_ajaran_lama: tahunAjaranLamaId, tahun_ajaran_baru: tahunAjaranBaruId,
    mapping_json: JSON.stringify(mapping), requested_by: auth.email, requested_at: now,
    status: 'COMPLETED', processed_by: auth.email, processed_at: now, notes: notes
  });

  AuditLog_write_(auth, 'EXECUTE_KENAIKAN_KELAS', 'KenaikanKelas', requestId, notes);

  Object.keys(affectedKelas).forEach(function (kelasId) {
    Siswa_syncTeachersForKelas_(kelasId, tahunAjaranBaruId, plan.semester_baru);
  });

  return { promoted: totalPromoted, lulus: totalLulus, excluded: totalExcluded, request_id: requestId };
}

/**
 * KenaikanKelas_markAlumni_(siswaIds)
 * Status MASTER_SISWA (identitas global) ikut diset ALUMNI — bukan cuma
 * RIWAYAT_KELAS-nya — supaya siswa itu tidak lagi muncul sebagai
 * kandidat aktif di layar lain (Kelola Siswa per Kelas, dst.).
 */
function KenaikanKelas_markAlumni_(siswaIds) {
  if (!siswaIds.length) return;
  const sh = Config_getSheet_('MASTER_SISWA');
  const idSet = {};
  siswaIds.forEach(function (id) { idSet[id] = true; });
  const values = sh.getDataRange().getValues();
  const header = values[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const idx = Utils_headerIndex_(header);
  let changed = false;
  for (let i = 1; i < values.length; i++) {
    if (idSet[values[i][idx.siswa_id]]) { values[i][idx.status] = 'ALUMNI'; values[i][idx.updated_at] = new Date(); changed = true; }
  }
  if (changed) sh.getRange(1, 1, values.length, header.length).setValues(values);
}

function adminGetKenaikanKelasHistory(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const rows = Utils_sheetToObjects_(Config_getSheet_('REQUEST_KENAIKAN_KELAS')).map(function (r) { delete r._row; return r; });
  return sekolahId ? rows.filter(function (r) { return r.sekolah_id === sekolahId; }) : rows;
}
