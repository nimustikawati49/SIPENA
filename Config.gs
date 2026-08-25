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
  RESOURCE_MAP: ['id', 'guru_id', 'email', 'sekolah_id', 'spreadsheet_id', 'status', 'created_at'],
  MASTER_SEKOLAH: ['sekolah_id', 'npsn', 'nama_sekolah', 'jenjang', 'alamat', 'desa', 'kecamatan', 'kabupaten', 'provinsi', 'status', 'created_at', 'updated_at'],
  MASTER_MAPEL: ['mapel_id', 'kode_mapel', 'nama_mapel', 'jenjang', 'status'],
  MASTER_KELAS: ['kelas_id', 'sekolah_id', 'tingkat', 'nama_kelas', 'jenjang', 'program_keahlian', 'konsentrasi_keahlian', 'status'],
  GURU_MAPEL: ['guru_mapel_id', 'guru_id', 'mapel_id', 'sekolah_id', 'tahun_ajaran_id', 'status'],
  PENUGASAN_MENGAJAR: ['assignment_id', 'guru_id', 'mapel_id', 'kelas_id', 'sekolah_id', 'tahun_ajaran_id', 'semester', 'status'],
  MASTER_TAHUN_AJARAN: ['tahun_ajaran_id', 'label', 'semester', 'status'],
  SEKOLAH_PERIODE_AKTIF: ['sekolah_id', 'tahun_ajaran_id', 'semester', 'status', 'activated_at', 'activated_by'],
  AUDIT_LOG: ['timestamp', 'email', 'guru_id', 'sekolah_id', 'action', 'module', 'record_id', 'description']
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
  JADWAL: ['jadwal_id', 'mapel_id', 'kelas_id', 'hari', 'jam_ke', 'jam_mulai', 'jam_selesai', 'ruangan', 'keterangan', 'tahun_ajaran_id', 'semester', 'status'],
  PENGATURAN: ['kelas_id', 'mapel_id', 'tahun_ajaran_id', 'semester', 'kkm', 'nilai_min_target', 'nilai_max_target'],
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
  return Config_getCentralSpreadsheet_().getSheetByName(name);
}
