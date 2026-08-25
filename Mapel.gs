// Mapel.gs — CRUD MASTER_MAPEL. Superadmin only.

function adminGetSubjects() {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_MAPEL');
  return Utils_sheetToObjects_(sh).map(function (r) { delete r._row; return r; });
}

/**
 * Mapel_normalizeJenjang_(input)
 * Sebuah mapel (mis. "Informatika") bisa berlaku di lebih dari satu
 * jenjang sekaligus (SD-SMP-SMA-SMK) — dulu field ini single-select
 * sehingga mapel lintas-jenjang terpaksa diduplikasi jadi beberapa
 * mapel_id berbeda. `input` boleh array (dari checkbox multi-pilih di
 * UI) atau string comma-separated; disimpan sebagai string
 * comma-separated terurut ("SD,SMP,SMA,SMK"), kosong = berlaku semua
 * jenjang. Variasi "sekolah tertentu mulai dari kelas berapa" TIDAK
 * diatur di sini — itu domain Penugasan Mengajar (per sekolah, per
 * kelas), bukan properti mapel itu sendiri.
 */
function Mapel_normalizeJenjang_(input) {
  if (input === undefined) return undefined;
  const valid = ['SD', 'SMP', 'SMA', 'SMK'];
  const arr = Array.isArray(input) ? input : String(input || '').split(',');
  const cleaned = arr.map(function (j) { return String(j || '').toUpperCase().trim(); }).filter(function (j) { return j; });
  cleaned.forEach(function (j) {
    if (valid.indexOf(j) === -1) throw new Error('Jenjang "' + j + '" tidak valid.');
  });
  const uniq = cleaned.filter(function (j, i) { return cleaned.indexOf(j) === i; });
  uniq.sort(function (a, b) { return valid.indexOf(a) - valid.indexOf(b); });
  return uniq.join(',');
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
    jenjang: Mapel_normalizeJenjang_(data.jenjang) || '',
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
  ['kode_mapel', 'nama_mapel', 'status'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  if (data.jenjang !== undefined) patch.jenjang = Mapel_normalizeJenjang_(data.jenjang);
  Utils_updateRowByHeader_(sh, rowNum, patch);

  AuditLog_write_(auth, 'UPDATE_SUBJECT', 'Mapel', mapelId, JSON.stringify(patch));
  return { ok: true };
}
