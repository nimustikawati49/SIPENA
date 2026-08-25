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
  MASTER_SUPERADMIN: ['email', 'nama', 'status', 'foto_url', 'created_at'],
  MASTER_GURU: ['guru_id', 'email', 'nama_lengkap', 'nip', 'nuptk', 'sekolah_id', 'jabatan', 'status', 'no_hp', 'foto_url', 'ttd_url', 'created_at', 'updated_at'],
  RESOURCE_MAP: ['id', 'guru_id', 'email', 'sekolah_id', 'spreadsheet_id', 'status', 'created_at'],
  MASTER_SEKOLAH: ['sekolah_id', 'npsn', 'nama_sekolah', 'jenjang', 'alamat', 'desa', 'kecamatan', 'kabupaten', 'provinsi', 'status', 'created_at', 'updated_at'],
  MASTER_MAPEL: ['mapel_id', 'kode_mapel', 'nama_mapel', 'jenjang', 'status'],
  MASTER_KELAS: ['kelas_id', 'sekolah_id', 'tingkat', 'nama_kelas', 'jenjang', 'program_keahlian', 'konsentrasi_keahlian', 'status'],
  GURU_MAPEL: ['guru_mapel_id', 'guru_id', 'mapel_id', 'sekolah_id', 'tahun_ajaran_id', 'status'],
  PENUGASAN_MENGAJAR: ['assignment_id', 'guru_id', 'mapel_id', 'kelas_id', 'sekolah_id', 'tahun_ajaran_id', 'semester', 'status'],
  MASTER_TAHUN_AJARAN: ['tahun_ajaran_id', 'label', 'semester', 'status'],
  SEKOLAH_PERIODE_AKTIF: ['sekolah_id', 'tahun_ajaran_id', 'semester', 'status', 'activated_at', 'activated_by'],
  MASTER_SISWA: ['siswa_id', 'sekolah_id', 'nis', 'nisn', 'nama_lengkap', 'jenis_kelamin', 'tanggal_lahir', 'tahun_masuk', 'status', 'created_at', 'updated_at'],
  RIWAYAT_KELAS: ['riwayat_id', 'siswa_id', 'sekolah_id', 'tahun_ajaran_id', 'semester', 'kelas_id', 'status', 'tanggal_mulai', 'tanggal_selesai', 'keterangan'],
  REQUEST_KENAIKAN_KELAS: ['request_id', 'sekolah_id', 'tahun_ajaran_lama', 'tahun_ajaran_baru', 'mapping_json', 'requested_by', 'requested_at', 'status', 'processed_by', 'processed_at', 'notes'],
  JADWAL_MENGAJAR: ['jadwal_id', 'guru_id', 'mapel_id', 'kelas_id', 'sekolah_id', 'tahun_ajaran_id', 'semester', 'hari', 'jam_mulai', 'jam_selesai', 'ruangan', 'keterangan', 'status'],
  REQUEST_JADWAL_PERUBAHAN: ['request_id', 'guru_id', 'jadwal_id_terkait', 'perubahan_json', 'alasan', 'requested_at', 'status', 'processed_by', 'processed_at', 'catatan'],
  SYNC_QUEUE: ['queue_id', 'guru_id', 'status', 'attempt', 'last_error', 'created_at', 'updated_at'],
  AUDIT_LOG: ['timestamp', 'email', 'guru_id', 'sekolah_id', 'action', 'module', 'record_id', 'description']
};

// PENGATURAN_BOBOT_NILAI SENGAJA TIDAK dimasukkan ke CONFIG_CENTRAL_SCHEMA_
// di atas — semua entri di sana di-ensure (dibuat kalau belum ada) pada
// SETIAP panggilan Config_getSheet_(), termasuk dari getAuth() yang
// dipanggil oleh SEMUA user (guru maupun superadmin) di setiap load
// halaman. Kalau guru yang PERTAMA kali memicu pembuatan sheet baru itu,
// dan akun guru tidak punya izin Drive untuk operasi struktural
// (insertSheet) di spreadsheet central — beda dengan sekadar
// baca/tulis sel di sheet yang SUDAH ada — getAuth() gagal total untuk
// SEMUA orang (bukan cuma fitur bobot nilai). Sheet ini murni domain
// Superadmin, jadi dibuat LAZY hanya dari adminSaveBobotNilai (Sekolah.gs)
// lewat Config_ensureCentralSheet_ di bawah — selalu berjalan sebagai
// Superadmin yang mengelola filenya sendiri.
const CONFIG_BOBOT_NILAI_SHEET_ = 'PENGATURAN_BOBOT_NILAI';
const CONFIG_BOBOT_NILAI_HEADERS_ = ['sekolah_id', 'bobot_harian', 'bobot_pts', 'bobot_akhir_semester', 'mode_perhitungan', 'decimal_places', 'updated_at', 'updated_by'];

// Kolom "kode" yang HARUS selalu tersimpan sebagai teks, bukan angka —
// Google Sheets otomatis membuang nol di depan (mis. "001" jadi 1) untuk
// sel berformat default begitu isinya terlihat seperti angka. NPSN, NIP,
// NUPTK, dan kode mapel di Indonesia lazim berawalan nol, jadi ini bukan
// isu kosmetik. Lihat Config_ensureTextFormatColumns_.
const CONFIG_TEXT_FORMAT_COLUMNS_ = {
  MASTER_SEKOLAH: ['npsn'],
  MASTER_GURU: ['nip', 'nuptk'],
  MASTER_MAPEL: ['kode_mapel'],
  MASTER_KELAS: ['tingkat'],
  MASTER_SISWA: ['nis', 'nisn']
};

// Sheet yang dibuat di spreadsheet PRIBADI tiap guru saat provisioning
// (bukan sheet central). Lihat Guru.gs: Guru_provisionSpreadsheet_.
const CONFIG_GURU_OPERATIONAL_SCHEMA_ = {
  PROFIL: ['guru_id', 'email', 'nama_lengkap', 'nip', 'nuptk', 'sekolah_id', 'jabatan', 'no_hp', 'foto_url', 'ttd_url', 'updated_at'],
  MAPEL: ['guru_mapel_id', 'mapel_id', 'kode_mapel', 'nama_mapel', 'tahun_ajaran_id', 'status'],
  KELAS: ['kelas_id', 'nama_kelas', 'tingkat', 'jenjang', 'status'],
  PENUGASAN: ['assignment_id', 'mapel_id', 'nama_mapel', 'kelas_id', 'nama_kelas', 'tahun_ajaran_id', 'semester', 'status'],
  SISWA: ['siswa_id', 'nis', 'nisn', 'nama_lengkap', 'jenis_kelamin', 'kelas_id', 'status'],
  NILAI: ['nilai_id', 'siswa_id', 'guru_id', 'mapel_id', 'kelas_id', 'sekolah_id', 'tahun_ajaran_id', 'semester', 'jenis_nilai', 'sumber_nilai', 'nilai_murni', 'nilai_katrol', 'asal_sekolah', 'tanggal_input', 'keterangan'],
  RIWAYAT_NILAI: ['riwayat_id', 'nilai_id', 'nilai_sebelum', 'nilai_sesudah', 'updated_by', 'updated_at'],
  JADWAL: ['jadwal_id', 'mapel_id', 'nama_mapel', 'kelas_id', 'nama_kelas', 'hari', 'jam_mulai', 'jam_selesai', 'ruangan', 'keterangan', 'tahun_ajaran_id', 'semester', 'status'],
  PENGATURAN: ['kelas_id', 'mapel_id', 'tahun_ajaran_id', 'semester', 'kkm', 'nilai_min_target', 'nilai_max_target'],
  NILAI_AKHIR: ['nilai_akhir_id', 'siswa_id', 'guru_id', 'mapel_id', 'kelas_id', 'sekolah_id', 'tahun_ajaran_id', 'semester', 'rata_rata_harian', 'nilai_akhir_murni', 'nilai_akhir_katrol', 'status_nilai', 'updated_at'],
  LOG: ['timestamp', 'aksi', 'keterangan']
};

/**
 * Config_ensureCentralSchema_()
 * Idempoten: buat sheet + header kalau belum ada. Dipanggil dari
 * Config_getSheet_() supaya sheet yang dibutuhkan selalu siap tanpa
 * langkah setup manual terpisah.
 *
 * SENGAJA TIDAK di-cache dengan flag "sudah pernah jalan" — daftar sheet
 * di CONFIG_CENTRAL_SCHEMA_ bertambah tiap fase (Phase 2 menambah
 * MASTER_SEKOLAH dkk. di atas fondasi Phase 1). Cache semacam itu akan
 * membuat sheet baru tidak pernah dibuat kalau flag-nya masih hidup dari
 * deploy sebelumnya.
 *
 * DIKUNCI dengan LockService: frontend menembak beberapa adminGetXxx()
 * sekaligus saat panel dibuka (lihat SuperAdmin_loadAll), dan tanpa lock,
 * dua eksekusi paralel yang sama-sama melihat sheet "belum ada" bisa
 * sama-sama memanggil insertSheet(nama yang sama) — Sheets API menolak
 * nama sheet duplikat, jadi salah satu eksekusi gagal dengan exception.
 * Lock singkat di sini jauh lebih murah daripada request pemanggil
 * (adminGetSchools dkk.) gagal secara acak. getSheetByName() untuk sheet
 * yang SUDAH ada tetap murah dan tidak butuh lock (fast path).
 */
function Config_ensureCentralSchema_() {
  const ss = Config_getCentralSpreadsheet_();
  const missing = Object.keys(CONFIG_CENTRAL_SCHEMA_).filter(function (name) {
    return !ss.getSheetByName(name);
  });
  if (missing.length === 0) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let createdAny = false;
    missing.forEach(function (name) {
      let sh = ss.getSheetByName(name);
      if (!sh) {
        sh = ss.insertSheet(name);
        sh.getRange(1, 1, 1, CONFIG_CENTRAL_SCHEMA_[name].length).setValues([CONFIG_CENTRAL_SCHEMA_[name]]);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, CONFIG_CENTRAL_SCHEMA_[name].length).setFontWeight('bold');
        createdAny = true;
      }
    });

    if (createdAny) {
      try {
        const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Lembar1');
        if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
      } catch (e) {}
    }
  } finally {
    lock.releaseLock();
  }
}

function Config_getSheet_(name) {
  Config_ensureCentralSchema_();
  Config_ensureTextFormatColumns_();
  Config_ensureColumnsMigration_();
  return Config_getCentralSpreadsheet_().getSheetByName(name);
}

/**
 * Config_ensureColumnsMigration_()
 * Sheet yang SUDAH ADA tidak otomatis dapat kolom baru walau
 * CONFIG_CENTRAL_SCHEMA_ diperbarui (Config_ensureCentralSchema_ cuma
 * membuat sheet yang belum ada). Fungsi ini menambah kolom yang HILANG
 * di akhir sheet (tidak pernah menghapus/menggeser kolom lama) — dipakai
 * pertama kali untuk menambah foto_url ke MASTER_SUPERADMIN yang sudah
 * ada sejak Phase 1. Bump nama property (_V1 -> _V2) tiap kali skema
 * central bertambah kolom baru di masa depan, sama seperti pola
 * Config_ensureTextFormatColumns_.
 */
function Config_ensureColumnsMigration_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('COLUMNS_MIGRATION_V1')) return;

  const ss = Config_getCentralSpreadsheet_();
  Object.keys(CONFIG_CENTRAL_SCHEMA_).forEach(function (sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    const lastCol = sh.getLastColumn();
    const header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); }) : [];
    const missing = CONFIG_CENTRAL_SCHEMA_[sheetName].filter(function (col) { return header.indexOf(col) === -1; });
    if (missing.length) {
      sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
      sh.getRange(1, lastCol + 1, 1, missing.length).setFontWeight('bold');
    }
  });

  props.setProperty('COLUMNS_MIGRATION_V1', '1');
}

/**
 * Config_ensureTextFormatColumns_()
 * Terapkan format Plain text ("@") ke seluruh kolom "kode" (lihat
 * CONFIG_TEXT_FORMAT_COLUMNS_) sekali saja, ditandai lewat Script
 * Property (bukan CacheService yang kedaluwarsa) supaya tidak perlu buka
 * spreadsheet & scan header di setiap request setelah yang pertama.
 * Bump nama property (_V1 -> _V2) kalau nanti menambah kolom baru ke
 * daftar itu, supaya migrasi jalan ulang untuk kolom yang baru saja.
 */
function Config_ensureTextFormatColumns_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TEXT_FORMAT_APPLIED_V2')) return;

  const ss = Config_getCentralSpreadsheet_();
  Object.keys(CONFIG_TEXT_FORMAT_COLUMNS_).forEach(function (sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    Config_applyTextFormat_(sh, CONFIG_TEXT_FORMAT_COLUMNS_[sheetName]);
  });

  props.setProperty('TEXT_FORMAT_APPLIED_V2', '1');
}

/**
 * Config_ensureGuruSheet_(ss, sheetName)
 * Sheet operasional guru cuma dibuat SEKALI saat provisioning
 * (Guru_provisionSpreadsheet_) — guru yang spreadsheet-nya sudah dibuat
 * SEBELUM sheetName ini ditambahkan ke CONFIG_GURU_OPERATIONAL_SCHEMA_
 * tidak otomatis punya sheet ini. Self-healing murah: getSheetByName()
 * gagal → buat sekali, sesudahnya selalu ada (tidak perlu flag versi
 * seperti migrasi central, karena cek keberadaan sheet sendiri sudah
 * murah dan idempoten).
 */
function Config_ensureGuruSheet_(ss, sheetName) {
  let sh = ss.getSheetByName(sheetName);
  if (sh) return sh;
  const headers = CONFIG_GURU_OPERATIONAL_SCHEMA_[sheetName];
  sh = ss.insertSheet(sheetName);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sh;
}

/**
 * Config_ensureCentralSheet_(name, headers)
 * Sama seperti Config_ensureGuruSheet_ tapi untuk spreadsheet central —
 * dipakai HANYA oleh fungsi yang sudah pasti berjalan sebagai Superadmin
 * (lihat catatan di CONFIG_BOBOT_NILAI_SHEET_ di atas), supaya operasi
 * struktural (insertSheet) tidak pernah dicoba dari konteks eksekusi guru.
 */
function Config_ensureCentralSheet_(name, headers) {
  const ss = Config_getCentralSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sh;
}

function Config_applyTextFormat_(sh, colNames) {
  if (!colNames || !colNames.length) return;
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').toLowerCase().trim(); });
  colNames.forEach(function (colName) {
    const idx = header.indexOf(colName);
    if (idx === -1) return;
    sh.getRange(1, idx + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}
