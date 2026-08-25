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

/**
 * adminCreateAssignmentBatch(guruId, mapelId, kelasIds, tahunAjaranId, semester)
 * Satu guru sering diajar di banyak kelas sekaligus untuk 1 mapel+periode
 * (bisa 10+ kelas) — checkbox multi-pilih kelas di UI, satu kali submit.
 * Kombinasi yang sudah ada dilewati (bukan error, supaya submit ulang
 * dengan sebagian kelas tumpang-tindih tidak gagal total), sisanya
 * ditulis dalam SATU batch setValues (bukan satu appendRow per kelas),
 * lalu sinkronisasi guru dijalankan SEKALI di akhir (bukan per kelas).
 */
function adminCreateAssignmentBatch(guruId, mapelId, kelasIds, tahunAjaranId, semester) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  guruId = String(guruId || '').trim();
  mapelId = String(mapelId || '').trim();
  tahunAjaranId = String(tahunAjaranId || '').trim();
  semester = String(semester || '').toUpperCase().trim();
  const ids = (Array.isArray(kelasIds) ? kelasIds : []).map(function (k) { return String(k || '').trim(); }).filter(function (k) { return k; });

  if (!guruId || !mapelId || !tahunAjaranId) throw new Error('Guru, mapel, dan tahun ajaran wajib diisi.');
  if (!ids.length) throw new Error('Pilih minimal satu kelas.');
  if (['GANJIL', 'GENAP'].indexOf(semester) === -1) throw new Error('Semester harus GANJIL atau GENAP.');

  const guru = Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')).filter(function (r) { return r.guru_id === guruId; })[0];
  if (!guru) throw new Error('Guru tidak ditemukan.');

  Penugasan_ensureGuruMapel_(guruId, mapelId, guru.sekolah_id, tahunAjaranId);

  const sh = Config_getSheet_('PENUGASAN_MENGAJAR');
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').toLowerCase().trim(); });

  const existingKeys = {};
  Utils_sheetToObjects_(sh).forEach(function (r) {
    existingKeys[[r.guru_id, r.mapel_id, r.kelas_id, r.tahun_ajaran_id, r.semester].join('|')] = true;
  });

  const newRows = [];
  const created = [];
  const skipped = [];
  ids.forEach(function (kelasId) {
    const key = [guruId, mapelId, kelasId, tahunAjaranId, semester].join('|');
    if (existingKeys[key]) { skipped.push(kelasId); return; }
    existingKeys[key] = true; // cegah duplikat dalam batch yang sama juga (kalau id terkirim dobel)
    const obj = {
      assignment_id: Utils_newId_('PN'), guru_id: guruId, mapel_id: mapelId, kelas_id: kelasId,
      sekolah_id: guru.sekolah_id, tahun_ajaran_id: tahunAjaranId, semester: semester, status: 'AKTIF'
    };
    newRows.push(header.map(function (k) { return obj[k] === undefined ? '' : obj[k]; }));
    created.push(kelasId);
  });

  if (newRows.length) {
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, newRows.length, header.length).setValues(newRows);
  }

  if (created.length) {
    AuditLog_write_(
      auth, 'CREATE_ASSIGNMENT_BATCH', 'Penugasan', guruId + '/' + mapelId,
      'kelas: ' + created.join(', ') + (skipped.length ? ' | dilewati (sudah ada): ' + skipped.join(', ') : '')
    );
    Sync_teacherData_(guruId);
  }

  return { created: created, skipped: skipped };
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

/**
 * adminUpdateAssignment(assignmentId, data)
 * Mendukung dua mode: patch status saja (data hanya berisi `status`), atau
 * edit penuh (guru_id/mapel_id/kelas_id/tahun_ajaran_id/semester) dari
 * form "Tambah Penugasan" yang dipakai ulang untuk edit. Kalau guru_id
 * berubah, sinkronisasi dijalankan untuk guru LAMA (supaya baris usang
 * hilang dari spreadsheet-nya) maupun guru BARU.
 */
function adminUpdateAssignment(assignmentId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('PENUGASAN_MENGAJAR');
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.assignment_id === assignmentId; })[0];
  if (!row) throw new Error('Penugasan tidak ditemukan.');

  const isFullEdit = data.guru_id !== undefined || data.mapel_id !== undefined || data.kelas_id !== undefined;
  const patch = {};

  if (isFullEdit) {
    const guruId = String(data.guru_id || row.guru_id).trim();
    const mapelId = String(data.mapel_id || row.mapel_id).trim();
    const kelasId = String(data.kelas_id || row.kelas_id).trim();
    const tahunAjaranId = String(data.tahun_ajaran_id || row.tahun_ajaran_id).trim();
    const semester = String(data.semester || row.semester).toUpperCase().trim();
    if (!guruId || !mapelId || !kelasId || !tahunAjaranId) throw new Error('Guru, mapel, kelas, dan tahun ajaran wajib diisi.');
    if (['GANJIL', 'GENAP'].indexOf(semester) === -1) throw new Error('Semester harus GANJIL atau GENAP.');

    const guru = Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')).filter(function (r) { return r.guru_id === guruId; })[0];
    if (!guru) throw new Error('Guru tidak ditemukan.');

    const dup = Utils_sheetToObjects_(sh).filter(function (r) {
      return r.assignment_id !== assignmentId && r.guru_id === guruId && r.mapel_id === mapelId &&
        r.kelas_id === kelasId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
    })[0];
    if (dup) throw new Error('Sudah ada penugasan lain dengan kombinasi guru/mapel/kelas/periode yang sama.');

    Penugasan_ensureGuruMapel_(guruId, mapelId, guru.sekolah_id, tahunAjaranId);

    patch.guru_id = guruId;
    patch.mapel_id = mapelId;
    patch.kelas_id = kelasId;
    patch.sekolah_id = guru.sekolah_id;
    patch.tahun_ajaran_id = tahunAjaranId;
    patch.semester = semester;
  }
  if (data.status !== undefined) patch.status = data.status;

  Utils_updateRowByHeader_(sh, row._row, patch);
  AuditLog_write_(auth, 'UPDATE_ASSIGNMENT', 'Penugasan', assignmentId, JSON.stringify(patch));

  Sync_teacherData_(row.guru_id);
  if (patch.guru_id && patch.guru_id !== row.guru_id) Sync_teacherData_(patch.guru_id);
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
