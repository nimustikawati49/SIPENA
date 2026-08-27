// Sync.gs — dorong data master (profil, mapel, penugasan, kelas, siswa,
// jadwal) ke spreadsheet pribadi guru setelah ada perubahan di central.
// 1 guru per panggilan. Kegagalan (mis. spreadsheet guru dihapus/kuota
// Drive habis) TIDAK menggagalkan aksi admin yang memicunya (kenaikan
// kelas ke puluhan guru dkk. tetap lanjut ke guru lain) — dicatat ke
// SYNC_QUEUE (Phase 8) supaya Superadmin bisa lihat & retry manual dari
// UI, bukan cuma tenggelam di _LOG_ERROR_.

function Sync_teacherData_(guruId) {
  try {
    const ss = Config_getGuruSpreadsheet_(guruId);
    const guru = Sync_findGuru_(guruId);
    if (!guru) return;

    Sync_updateProfil_(ss, guru);
    Sync_rewriteMapel_(ss, guruId);
    Sync_rewritePenugasanAndKelas_(ss, guruId);
    Sync_rewriteSiswa_(ss, guruId);
    // Jadwal TIDAK disinkron dari central lagi — sheet JADWAL pribadi
    // guru sekarang jadi sumber kebenarannya sendiri (lihat Jadwal.gs).
    // Menimpanya di sini akan menghapus jadwal yang guru masukkan sendiri
    // setiap kali sinkronisasi lain (mapel/penugasan/siswa) berjalan.
    Dashboard_invalidateCache_(guruId);
    Sync_clearQueueEntry_(guruId);
  } catch (e) {
    Utils_logError_('SYNC_TEACHER_DATA_' + guruId, e);
    Sync_enqueueFailure_(guruId, e);
  }
}

/**
 * Sync_enqueueFailure_(guruId, err)
 * Satu baris PENDING per guru (bukan menumpuk baris baru tiap gagal) —
 * kalau sudah ada entri PENDING untuk guru ini, cukup naikkan attempt +
 * update pesan error & waktu.
 */
function Sync_enqueueFailure_(guruId, err) {
  try {
    const sh = Config_getSheet_('SYNC_QUEUE');
    const existing = Utils_sheetToObjects_(sh).filter(function (r) {
      return r.guru_id === guruId && r.status === 'PENDING';
    })[0];
    const msg = String(err && err.message ? err.message : err).substring(0, 300);
    const now = new Date();
    if (existing) {
      Utils_updateRowByHeader_(sh, existing._row, { attempt: Number(existing.attempt || 0) + 1, last_error: msg, updated_at: now });
    } else {
      Utils_appendRowByHeader_(sh, { queue_id: Utils_newId_('SQ'), guru_id: guruId, status: 'PENDING', attempt: 1, last_error: msg, created_at: now, updated_at: now });
    }
  } catch (e2) { /* jangan sampai pencatatan antrian ikut menggagalkan proses utama */ }
}

function Sync_clearQueueEntry_(guruId) {
  try {
    const sh = Config_getSheet_('SYNC_QUEUE');
    const existing = Utils_sheetToObjects_(sh).filter(function (r) {
      return r.guru_id === guruId && r.status === 'PENDING';
    })[0];
    if (existing) Utils_updateRowByHeader_(sh, existing._row, { status: 'RESOLVED', updated_at: new Date() });
  } catch (e) {}
}

function adminGetSyncQueue() {
  Security_requireRole_(['SUPERADMIN']);
  const guruById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')), 'guru_id');
  return Utils_sheetToObjects_(Config_getSheet_('SYNC_QUEUE'))
    .filter(function (r) { return r.status === 'PENDING'; })
    .map(function (r) {
      delete r._row;
      return Object.assign({}, r, { nama_guru: (guruById[r.guru_id] || {}).nama_lengkap || r.guru_id });
    })
    .sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
}

/**
 * adminRetrySyncQueue(guruId)
 * Panggil ulang Sync_teacherData_ untuk satu guru — kalau berhasil,
 * Sync_clearQueueEntry_ di dalamnya otomatis menandai entri PENDING jadi
 * RESOLVED (tidak perlu logika terpisah di sini).
 */
function adminRetrySyncQueue(guruId) {
  Security_requireRole_(['SUPERADMIN']);
  Sync_teacherData_(guruId);
  const stillPending = Utils_sheetToObjects_(Config_getSheet_('SYNC_QUEUE')).some(function (r) {
    return r.guru_id === guruId && r.status === 'PENDING';
  });
  return { ok: !stillPending };
}

function Sync_findGuru_(guruId) {
  return Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')).filter(function (r) {
    return r.guru_id === guruId;
  })[0] || null;
}

/**
 * Sync_updateProfil_
 * Hanya menimpa field read-only (nama/nip/sekolah/jabatan/email) —
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

/**
 * Sync_rewriteSiswa_(ss, guruId)
 * Roster siswa di sheet SISWA guru = gabungan siswa AKTIF (RIWAYAT_KELAS)
 * di semua kelas+periode yang guru ini ajar (PENUGASAN_MENGAJAR AKTIF),
 * dedup per siswa_id — guru yang mengajar kelas yang sama untuk 2 mapel
 * tidak melihat siswa itu dobel.
 */
function Sync_rewriteSiswa_(ss, guruId) {
  const sh = ss.getSheetByName('SISWA');
  if (!sh) return;

  const assignments = Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR')).filter(function (r) {
    return r.guru_id === guruId && String(r.status).toUpperCase() === 'AKTIF';
  });
  if (!assignments.length) { Sync_clearAndWrite_(sh, []); return; }

  const scopeKeys = {};
  assignments.forEach(function (a) { scopeKeys[[a.kelas_id, a.tahun_ajaran_id, a.semester].join('|')] = true; });

  const riwayat = Utils_sheetToObjects_(Config_getSheet_('RIWAYAT_KELAS')).filter(function (r) {
    return String(r.status).toUpperCase() === 'AKTIF' && scopeKeys[[r.kelas_id, r.tahun_ajaran_id, r.semester].join('|')];
  });

  const siswaById = Sync_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_SISWA')), 'siswa_id');

  const seen = {};
  const rows = [];
  riwayat.forEach(function (r) {
    if (seen[r.siswa_id]) return;
    seen[r.siswa_id] = true;
    const s = siswaById[r.siswa_id];
    if (!s) return;
    rows.push({
      siswa_id: s.siswa_id, nis: s.nis, nama_lengkap: s.nama_lengkap,
      jenis_kelamin: s.jenis_kelamin, kelas_id: r.kelas_id, status: s.status
    });
  });

  Sync_clearAndWrite_(sh, rows);
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
