// Sync.gs — dorong data master (profil, mapel, penugasan, kelas) ke
// spreadsheet pribadi guru setelah ada perubahan di central. Phase 2:
// sinkron langsung, 1 guru per panggilan. Antrian+retry untuk sinkronisasi
// massal (mis. kenaikan kelas ke puluhan guru sekaligus) adalah Phase 8 —
// untuk sekarang kegagalan dicatat ke _LOG_ERROR_ dan tidak menggagalkan
// aksi admin yang memicunya.

function Sync_teacherData_(guruId) {
  try {
    const ss = Config_getGuruSpreadsheet_(guruId);
    const guru = Sync_findGuru_(guruId);
    if (!guru) return;

    Sync_updateProfil_(ss, guru);
    Sync_rewriteMapel_(ss, guruId);
    Sync_rewritePenugasanAndKelas_(ss, guruId);
    Dashboard_invalidateCache_(guruId);
  } catch (e) {
    Utils_logError_('SYNC_TEACHER_DATA_' + guruId, e);
  }
}

function Sync_findGuru_(guruId) {
  return Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')).filter(function (r) {
    return r.guru_id === guruId;
  })[0] || null;
}

/**
 * Sync_updateProfil_
 * Hanya menimpa field read-only (nama/nip/nuptk/sekolah/jabatan/email) —
 * foto_url/ttd_url/no_hp SENGAJA tidak disentuh di sini kalau baris sudah
 * ada, karena field itu akan jadi milik guru untuk diubah sendiri
 * (updateMyProfile, Phase 3). Sync yang menimpanya di sini akan
 * menghapus perubahan guru setiap kali Superadmin ubah data lain.
 */
function Sync_updateProfil_(ss, guru) {
  const sh = ss.getSheetByName('PROFIL');
  if (!sh) return;
  const readOnlyPatch = {
    guru_id: guru.guru_id,
    email: guru.email,
    nama_lengkap: guru.nama_lengkap,
    nip: guru.nip,
    nuptk: guru.nuptk,
    sekolah_id: guru.sekolah_id,
    jabatan: guru.jabatan
  };
  if (sh.getLastRow() < 2) {
    Utils_appendRowByHeader_(sh, readOnlyPatch);
  } else {
    Utils_updateRowByHeader_(sh, 2, readOnlyPatch);
  }
}

function Sync_rewriteMapel_(ss, guruId) {
  const sh = ss.getSheetByName('MAPEL');
  if (!sh) return;
  const mapelById = Sync_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_MAPEL')), 'mapel_id');
  const rows = Utils_sheetToObjects_(Config_getSheet_('GURU_MAPEL')).filter(function (r) {
    return r.guru_id === guruId && String(r.status).toUpperCase() === 'AKTIF';
  }).map(function (r) {
    const m = mapelById[r.mapel_id] || {};
    return {
      guru_mapel_id: r.guru_mapel_id,
      mapel_id: r.mapel_id,
      kode_mapel: m.kode_mapel || '',
      nama_mapel: m.nama_mapel || '-',
      tahun_ajaran_id: r.tahun_ajaran_id,
      status: r.status
    };
  });
  Sync_clearAndWrite_(sh, rows);
}

function Sync_rewritePenugasanAndKelas_(ss, guruId) {
  const penugasanSh = ss.getSheetByName('PENUGASAN');
  const kelasSh = ss.getSheetByName('KELAS');
  const mapelById = Sync_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_MAPEL')), 'mapel_id');
  const kelasById = Sync_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')), 'kelas_id');

  const assignments = Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR')).filter(function (r) {
    return r.guru_id === guruId && String(r.status).toUpperCase() === 'AKTIF';
  });

  if (penugasanSh) {
    const rows = assignments.map(function (r) {
      const m = mapelById[r.mapel_id] || {};
      const k = kelasById[r.kelas_id] || {};
      return {
        assignment_id: r.assignment_id,
        mapel_id: r.mapel_id,
        nama_mapel: m.nama_mapel || '-',
        kelas_id: r.kelas_id,
        nama_kelas: k.nama_kelas || '-',
        tahun_ajaran_id: r.tahun_ajaran_id,
        semester: r.semester,
        status: r.status
      };
    });
    Sync_clearAndWrite_(penugasanSh, rows);
  }

  if (kelasSh) {
    const seen = {};
    const rows = [];
    assignments.forEach(function (r) {
      if (seen[r.kelas_id]) return;
      seen[r.kelas_id] = true;
      const k = kelasById[r.kelas_id] || {};
      rows.push({
        kelas_id: r.kelas_id,
        nama_kelas: k.nama_kelas || '-',
        tingkat: k.tingkat || '',
        jenjang: k.jenjang || '',
        status: k.status || 'AKTIF'
      });
    });
    Sync_clearAndWrite_(kelasSh, rows);
  }
}

function Sync_indexBy_(rows, key) {
  const idx = {};
  rows.forEach(function (r) { idx[r[key]] = r; });
  return idx;
}

/**
 * Sync_clearAndWrite_(sh, rowObjects)
 * Hapus seluruh baris data (di bawah header), lalu tulis ulang dalam satu
 * batch setValues sesuai urutan header sheet target — pola baca-sekali/
 * tulis-sekali yang dipakai konsisten di seluruh SIPENA.
 */
function Sync_clearAndWrite_(sh, rowObjects) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (!rowObjects.length) return;

  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h || '').toLowerCase().trim(); });
  const values = rowObjects.map(function (obj) {
    return header.map(function (key) {
      const v = obj[key];
      return v === undefined || v === null ? '' : v;
    });
  });
  sh.getRange(2, 1, values.length, header.length).setValues(values);
}
