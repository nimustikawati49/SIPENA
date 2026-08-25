// Dashboard.gs — dashboard & profil guru (Phase 3). Pola "satu panggilan
// agregat" (getMyDashboard) sejak awal, bukan disusun dari N panggilan
// terpisah — pelajaran performa terpenting dari SAG (DASH_ALL).

/**
 * getMyDashboard()
 * GURU only. Baca PROFIL/MAPEL/KELAS/PENUGASAN dari spreadsheet PRIBADI
 * guru (resolve via auth.guruId, bukan parameter client) satu kali,
 * cache 300s dengan key yang menyertakan guru_id (CacheService.getScriptCache
 * — BUKAN getUserCache — supaya bisa di-invalidate dari eksekusi lain,
 * mis. Sync_teacherData_ yang berjalan sebagai Superadmin saat penugasan
 * guru berubah, bukan hanya dari sesi guru itu sendiri).
 */
function getMyDashboard() {
  const auth = Security_requireRole_(['GURU']);

  const cache = CacheService.getScriptCache();
  const cacheKey = Dashboard_cacheKey_(auth.guruId);
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* cache korup, baca ulang */ }
  }

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const profilRows = Utils_sheetToObjects_(ss.getSheetByName('PROFIL'));
  const profil = profilRows[0] || {};
  delete profil._row;

  const mapel = Utils_sheetToObjects_(ss.getSheetByName('MAPEL')).map(Dashboard_stripRow_);
  const kelas = Utils_sheetToObjects_(ss.getSheetByName('KELAS')).map(Dashboard_stripRow_);
  const penugasan = Utils_sheetToObjects_(ss.getSheetByName('PENUGASAN')).map(Dashboard_stripRow_);

  const sekolah = Utils_sheetToObjects_(Config_getSheet_('MASTER_SEKOLAH'))
    .filter(function (r) { return r.sekolah_id === profil.sekolah_id; })[0];

  const result = {
    profil: profil,
    nama_sekolah: sekolah ? sekolah.nama_sekolah : '-',
    ringkasan: {
      jumlah_mapel: mapel.length,
      jumlah_kelas: kelas.length,
      jumlah_penugasan_aktif: penugasan.filter(function (p) { return String(p.status).toUpperCase() === 'AKTIF'; }).length
    },
    mapel: mapel,
    kelas: kelas,
    penugasan: penugasan
  };

  try { cache.put(cacheKey, JSON.stringify(result), 300); } catch (e) { /* > 100KB, lewati cache */ }
  return result;
}

/**
 * updateMyProfile(data)
 * GURU only, dan HANYA field non-kritis (no_hp/foto_url/ttd_url) — nama,
 * NIP, sekolah, dsb. dikelola Superadmin (spec §11), tidak diterima di
 * sini walau dikirim client.
 */
function updateMyProfile(data) {
  const auth = Security_requireRole_(['GURU']);
  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const sh = ss.getSheetByName('PROFIL');
  if (!sh || sh.getLastRow() < 2) throw new Error('Profil belum tersedia. Hubungi Superadmin.');

  const patch = {};
  ['no_hp', 'foto_url', 'ttd_url'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  patch.updated_at = new Date();
  Utils_updateRowByHeader_(sh, 2, patch);

  Dashboard_invalidateCache_(auth.guruId);
  AuditLog_write_(auth, 'UPDATE_PROFILE', 'Profil', auth.guruId, JSON.stringify(patch));
  return { ok: true };
}

function Dashboard_cacheKey_(guruId) {
  return 'DASH_ALL_' + guruId;
}

function Dashboard_invalidateCache_(guruId) {
  try { CacheService.getScriptCache().remove(Dashboard_cacheKey_(guruId)); } catch (e) {}
}

function Dashboard_stripRow_(obj) {
  const copy = Object.assign({}, obj);
  delete copy._row;
  return copy;
}
