// Mapel.gs — CRUD MASTER_MAPEL. Superadmin only.

function adminGetSubjects() {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_MAPEL');
  return Utils_sheetToObjects_(sh).map(function (r) { delete r._row; return r; });
}

function adminCreateSubject(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const nama = String(data && data.nama_mapel || '').trim();
  if (!nama) throw new Error('Nama mata pelajaran wajib diisi.');

  const sh = Config_getSheet_('MASTER_MAPEL');
  const mapelId = Utils_newId_('MPL');
  Utils_appendRowByHeader_(sh, {
    mapel_id: mapelId,
    kode_mapel: data.kode_mapel || '',
    nama_mapel: nama,
    jenjang: String(data.jenjang || '').toUpperCase(),
    status: 'AKTIF'
  });

  AuditLog_write_(auth, 'CREATE_SUBJECT', 'Mapel', mapelId, nama);
  return { mapel_id: mapelId };
}

/**
 * adminDeleteSubject(mapelId)
 * Ditolak kalau masih dipakai di GURU_MAPEL/PENUGASAN_MENGAJAR mana pun.
 */
function adminDeleteSubject(mapelId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_MAPEL');
  const mapel = Utils_sheetToObjects_(sh).filter(function (r) { return r.mapel_id === mapelId; })[0];
  if (!mapel) throw new Error('Mata pelajaran tidak ditemukan.');

  const guruMapelCount = Utils_sheetToObjects_(Config_getSheet_('GURU_MAPEL'))
    .filter(function (r) { return r.mapel_id === mapelId; }).length;
  const penugasanCount = Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR'))
    .filter(function (r) { return r.mapel_id === mapelId; }).length;

  if (guruMapelCount > 0 || penugasanCount > 0) {
    throw new Error(
      'Mata pelajaran tidak bisa dihapus: masih dipakai di ' + guruMapelCount + ' data guru-mapel dan ' +
      penugasanCount + ' penugasan. Hapus/ubah dulu penugasan itu, atau nonaktifkan saja mapel ini.'
    );
  }

  Utils_deleteRowById_(sh, 'mapel_id', mapelId);
  AuditLog_write_(auth, 'DELETE_SUBJECT', 'Mapel', mapelId, mapel.nama_mapel);
  return { ok: true };
}

function adminUpdateSubject(mapelId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_MAPEL');
  const rowNum = Utils_findRowById_(sh, 'mapel_id', mapelId);
  if (rowNum === -1) throw new Error('Mata pelajaran tidak ditemukan.');

  const patch = {};
  ['kode_mapel', 'nama_mapel', 'jenjang', 'status'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  Utils_updateRowByHeader_(sh, rowNum, patch);

  AuditLog_write_(auth, 'UPDATE_SUBJECT', 'Mapel', mapelId, JSON.stringify(patch));
  return { ok: true };
}
