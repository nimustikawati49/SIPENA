// Config.gs — koneksi spreadsheet central + skema bootstrap + cache helper.
// Fase 1 cuma butuh MASTER_SUPERADMIN, MASTER_GURU, RESOURCE_MAP (untuk auth).
// Sheet master lain (MASTER_SEKOLAH, MASTER_MAPEL, dst.) ditambahkan Phase 2.

/**
 * Config_getCentralSpreadsheetId_()
 * ID spreadsheet central SIPENA_MASTER. Disimpan di Script Properties
 * (bukan hardcode) supaya bisa dikonfigurasi ulang tanpa ubah kode —
 * pola yang sama seperti SAG (SPREADSHEET_ID property).
 *
 * Kalau property belum diisi, dibuatkan otomatis SEKALI (idempoten,
 * hasilnya disimpan balik ke property) supaya deploy pertama tidak
 * butuh langkah manual "buat spreadsheet dulu".
 */
function Config_getCentralSpreadsheetId_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SIPENA_MASTER_SPREADSHEET_ID');
  if (id) return id;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    id = props.getProperty('SIPENA_MASTER_SPREADSHEET_ID');
    if (id) return id;
    const ss = SpreadsheetApp.create('SIPENA_MASTER');
    id = ss.getId();
    props.setProperty('SIPENA_MASTER_SPREADSHEET_ID', id);
    return id;
  } finally {
    lock.releaseLock();
  }
}

function Config_getCentralSpreadsheet_() {
  return SpreadsheetApp.openById(Config_getCentralSpreadsheetId_());
}

// Fallback superadmin pertama — sama filosofinya dengan SAG
// (_SUPERADMIN_FALLBACK): supaya deploy pertama bisa langsung diverifikasi
// tanpa harus isi sheet MASTER_SUPERADMIN secara manual dulu. Begitu email
// ini login pertama kali, baris resminya otomatis ditulis ke
// MASTER_SUPERADMIN (lihat Auth_resolve_) — fallback ini cuma dipakai kalau
// sheet MASTER_SUPERADMIN masih benar-benar kosong.
const CONFIG_SUPERADMIN_BOOTSTRAP_EMAIL = 'nimustikawati49@guru.smp.belajar.id';

const CONFIG_CENTRAL_SCHEMA_ = {
  MASTER_SUPERADMIN: ['email', 'nama', 'status', 'created_at'],
  MASTER_GURU: ['guru_id', 'email', 'nama_lengkap', 'nip', 'nuptk', 'sekolah_id', 'jabatan', 'status', 'no_hp', 'foto_url', 'ttd_url', 'created_at', 'updated_at'],
  RESOURCE_MAP: ['id', 'guru_id', 'email', 'sekolah_id', 'spreadsheet_id', 'status', 'created_at']
};

/**
 * Config_ensureCentralSchema_()
 * Idempoten: buat sheet + header kalau belum ada. Dipanggil dari
 * Auth_getAuth_() supaya sheet yang dibutuhkan auth selalu siap tanpa
 * langkah setup manual terpisah.
 */
function Config_ensureCentralSchema_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('SCHEMA_READY')) return;

  const ss = Config_getCentralSpreadsheet_();
  Object.keys(CONFIG_CENTRAL_SCHEMA_).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, CONFIG_CENTRAL_SCHEMA_[name].length).setValues([CONFIG_CENTRAL_SCHEMA_[name]]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, CONFIG_CENTRAL_SCHEMA_[name].length).setFontWeight('bold');
    }
  });

  // Hapus sheet default kosong ("Sheet1"/"Lembar1") kalau masih ada.
  try {
    const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Lembar1');
    if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  } catch (e) {}

  cache.put('SCHEMA_READY', '1', 3600);
}

function Config_getSheet_(name) {
  Config_ensureCentralSchema_();
  return Config_getCentralSpreadsheet_().getSheetByName(name);
}
