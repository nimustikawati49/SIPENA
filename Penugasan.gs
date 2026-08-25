// Penugasan.gs — GURU_MAPEL (mapel yang diampu guru) + PENUGASAN_MENGAJAR
// (assignment spesifik guru+mapel+kelas+periode). Superadmin only. Tiap
// perubahan memicu Sync_teacherData_ supaya spreadsheet pribadi guru
// selalu mencerminkan penugasan terbaru.

function adminGetAssignments(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const rows = Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR'))
    .map(function (r) { delete r._row; return r; });
  const filtered = sekolahId ? rows.filter(function (r) { return String(r.sekolah_id) === String(sekolahId); }) : rows;
  return Penugasan_enrichWithNames_(filtered);
}

function Penugasan_enrichWithNames_(rows) {
  const guruById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')), 'guru_id');
  const mapelById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_MAPEL')), 'mapel_id');
  const kelasById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')), 'kelas_id');
  return rows.map(function (r) {
    return Object.assign({}, r, {
      nama_guru: (guruById[r.guru_id] || {}).nama_lengkap || '-',
      nama_mapel: (mapelById[r.mapel_id] || {}).nama_mapel || '-',
      nama_kelas: (kelasById[r.kelas_id] || {}).nama_kelas || '-'
    });
  });
}

function Penugasan_indexBy_(rows, key) {
  const idx = {};
  rows.forEach(function (r) { idx[r[key]] = r; });
  return idx;
}

function adminCreateAssignment(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const guruId = String(data && data.guru_id || '').trim();
  const mapelId = String(data && data.mapel_id || '').trim();
  const kelasId = String(data && data.kelas_id || '').trim();
  const sekolahId = String(data && data.sekolah_id || '').trim();
  const tahunAjaranId = String(data && data.tahun_ajaran_id || '').trim();
  const semester = String(data && data.semester || '').toUpperCase().trim();

  if (!guruId || !mapelId || !kelasId || !sekolahId || !tahunAjaranId) {
    throw new Error('Guru, mapel, kelas, sekolah, dan tahun ajaran wajib diisi.');
  }
  if (['GANJIL', 'GENAP'].indexOf(semester) === -1) throw new Error('Semester harus GANJIL atau GENAP.');

  Penugasan_ensureGuruMapel_(guruId, mapelId, sekolahId, tahunAjaranId);

  const sh = Config_getSheet_('PENUGASAN_MENGAJAR');
  const existing = Utils_sheetToObjects_(sh).filter(function (r) {
    return r.guru_id === guruId && r.mapel_id === mapelId && r.kelas_id === kelasId &&
      r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
  })[0];
  if (existing) throw new Error('Penugasan ini sudah ada.');

  const assignmentId = Utils_newId_('PN');
  Utils_appendRowByHeader_(sh, {
    assignment_id: assignmentId,
    guru_id: guruId,
    mapel_id: mapelId,
    kelas_id: kelasId,
    sekolah_id: sekolahId,
    tahun_ajaran_id: tahunAjaranId,
    semester: semester,
    status: 'AKTIF'
  });

  AuditLog_write_(auth, 'CREATE_ASSIGNMENT', 'Penugasan', assignmentId, guruId + '/' + mapelId + '/' + kelasId);
  Sync_teacherData_(guruId);
  return { assignment_id: assignmentId };
}

function adminUpdateAssignment(assignmentId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('PENUGASAN_MENGAJAR');
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.assignment_id === assignmentId; })[0];
  if (!row) throw new Error('Penugasan tidak ditemukan.');

  const patch = {};
  if (data.status !== undefined) patch.status = data.status;
  Utils_updateRowByHeader_(sh, row._row, patch);

  AuditLog_write_(auth, 'UPDATE_ASSIGNMENT', 'Penugasan', assignmentId, JSON.stringify(patch));
  Sync_teacherData_(row.guru_id);
  return { ok: true };
}

/**
 * adminDeleteAssignment(assignmentId)
 * PENUGASAN_MENGAJAR adalah record "daun" (belum ada yang mereferensikan
 * assignment_id-nya di sheet lain), jadi aman dihapus langsung tanpa
 * guard referensi — tapi tetap perlu Sync_teacherData_ supaya baris di
 * spreadsheet pribadi guru ikut hilang, bukan jadi data basi.
 */
function adminDeleteAssignment(assignmentId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('PENUGASAN_MENGAJAR');
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.assignment_id === assignmentId; })[0];
  if (!row) throw new Error('Penugasan tidak ditemukan.');

  Utils_deleteRowById_(sh, 'assignment_id', assignmentId);
  AuditLog_write_(auth, 'DELETE_ASSIGNMENT', 'Penugasan', assignmentId, row.guru_id + '/' + row.mapel_id + '/' + row.kelas_id);
  Sync_teacherData_(row.guru_id);
  return { ok: true };
}

function Penugasan_ensureGuruMapel_(guruId, mapelId, sekolahId, tahunAjaranId) {
  const sh = Config_getSheet_('GURU_MAPEL');
  const existing = Utils_sheetToObjects_(sh).filter(function (r) {
    return r.guru_id === guruId && r.mapel_id === mapelId &&
      r.sekolah_id === sekolahId && r.tahun_ajaran_id === tahunAjaranId;
  })[0];
  if (existing) return existing.guru_mapel_id;

  const guruMapelId = Utils_newId_('GM');
  Utils_appendRowByHeader_(sh, {
    guru_mapel_id: guruMapelId,
    guru_id: guruId,
    mapel_id: mapelId,
    sekolah_id: sekolahId,
    tahun_ajaran_id: tahunAjaranId,
    status: 'AKTIF'
  });
  return guruMapelId;
}
