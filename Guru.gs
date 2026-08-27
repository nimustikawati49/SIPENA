// Guru.gs — CRUD MASTER_GURU + provisioning spreadsheet pribadi per guru.
//
// PERUBAHAN ARSITEKTUR PENTING: provisioning dulu dipicu eksplisit saat
// Superadmin "Tambah Guru" — spreadsheet-nya jadi dibuat & DIMILIKI akun
// Superadmin (SpreadsheetApp.create berjalan sebagai siapa pun yang
// mengakses, sesuai executeAs: USER_ACCESSING di appsscript.json), lalu
// cuma DIBAGIKAN (addEditor) ke guru. Itu ternyata rapuh: berbagi file
// lintas akun bisa ditolak diam-diam oleh kebijakan Workspace (terutama
// domain pendidikan yang membatasi sharing, bahkan SESAMA domain), dan
// sama sekali tidak berlaku kalau guru memakai akun Gmail pribadi di luar
// domain sekolah. Juga membuat SEMUA data guru (nilai, jadwal, foto)
// menumpuk di kuota Drive Superadmin.
//
// Sekarang: Superadmin "Tambah Guru" HANYA mendaftarkan identitasnya di
// MASTER_GURU (central) — TIDAK membuat spreadsheet apa pun. Spreadsheet
// pribadi guru baru dibuat LAZY saat guru itu SENDIRI login pertama kali
// (lihat Guru_ensureOwnSpreadsheet_, dipanggil dari Auth_resolve_) —
// karena saat itu skrip berjalan SEBAGAI guru (executeAs: USER_ACCESSING),
// SpreadsheetApp.create() otomatis membuat file yang DIMILIKI akun guru
// itu sendiri, di Drive-nya sendiri, apa pun jenis akunnya (gmail.com
// maupun belajar.id) — tidak perlu addEditor/sharing sama sekali untuk
// guru bisa memakainya. Superadmin tetap diberi akses Editor (dibagikan
// OLEH guru, pemilik file, ke Superadmin) supaya tetap bisa membuka &
// memperbaiki data guru itu kalau ada error — lihat Guru_grantSuperadminAccess_.
//
// Guru yang SUDAH terprovisi lewat arsitektur LAMA (spreadsheet-nya masih
// dimiliki Superadmin) TIDAK dipindahkan ke spreadsheet baru — SATU
// spreadsheet per guru, selamanya, supaya tidak pernah ada ambiguitas
// "yang mana yang sebenarnya dipakai" baik bagi guru maupun Superadmin.
// Perbaikan akses untuk kasus ini lewat adminReprovisionTeacher (tombol
// "Tandai Perbaikan Akses" di UI Superadmin) + Guru_ensureOwnSpreadsheet_,
// bukan lewat pembuatan file pengganti.

function adminGetTeachers(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_GURU');
  const rows = Utils_sheetToObjects_(sh).map(function (r) { delete r._row; r.no_hp = Utils_normalizeNoHp_(r.no_hp); return r; });
  if (!sekolahId) return rows;
  return rows.filter(function (r) { return String(r.sekolah_id) === String(sekolahId); });
}

function adminCreateTeacher(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);

  const email = String(data && data.email || '').toLowerCase().trim();
  const namaLengkap = String(data && data.nama_lengkap || '').trim();
  const sekolahId = String(data && data.sekolah_id || '').trim();
  if (!email || email.indexOf('@') === -1) throw new Error('Email guru wajib diisi dengan benar.');
  if (!namaLengkap) throw new Error('Nama lengkap guru wajib diisi.');
  if (!sekolahId) throw new Error('Sekolah wajib dipilih.');
  if (Auth_findGuru_(email)) throw new Error('Email ini sudah terdaftar sebagai guru.');

  const guruId = Utils_newId_('GR');
  const sh = Config_getSheet_('MASTER_GURU');
  Utils_appendRowByHeader_(sh, {
    guru_id: guruId,
    email: email,
    nama_lengkap: namaLengkap,
    nip: data.nip || '',
    sekolah_id: sekolahId,
    jabatan: data.jabatan || 'Guru',
    status: 'AKTIF',
    no_hp: Utils_normalizeNoHp_(data.no_hp),
    foto_url: '',
    ttd_url: '',
    created_at: new Date(),
    updated_at: new Date()
  });

  // Spreadsheet pribadi TIDAK dibuat di sini lagi — baru dibuat otomatis
  // saat guru ini login pertama kali, supaya dimiliki akun guru sendiri
  // (lihat catatan arsitektur di atas berkas ini).
  AuditLog_write_(auth, 'CREATE_TEACHER', 'Guru', guruId, email);
  return { guru_id: guruId };
}

function adminUpdateTeacher(guruId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_GURU');
  const guru = Utils_sheetToObjects_(sh).filter(function (r) { return r.guru_id === guruId; })[0];
  if (!guru) throw new Error('Guru tidak ditemukan.');

  // guru_id, email, sekolah_id TIDAK boleh diubah lewat sini (walau oleh
  // Superadmin) demi konsistensi RESOURCE_MAP/PENUGASAN yang sudah
  // mereferensikannya — pindah sekolah/ganti email butuh alur mutasi
  // tersendiri, bukan edit biasa. NIP/jabatan boleh diubah karena
  // itu memang data administrasi yang dikelola Superadmin (spec §11).
  const patch = {};
  ['nama_lengkap', 'nip', 'jabatan', 'status', 'no_hp'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  if (patch.no_hp !== undefined) patch.no_hp = Utils_normalizeNoHp_(patch.no_hp);
  patch.updated_at = new Date();
  Utils_updateRowByHeader_(sh, guru._row, patch);

  Auth_invalidateCache_(guru.email);
  AuditLog_write_(auth, 'UPDATE_TEACHER', 'Guru', guruId, JSON.stringify(patch));
  return { ok: true };
}

/**
 * adminDeleteTeacher(guruId)
 * Ditolak kalau guru masih punya penugasan/mapel apa pun — mandat "jangan
 * hapus histori" berlaku begitu penugasan pernah dibuat (audit log, sync
 * ke spreadsheet guru lain, dst. sudah mereferensikan guru_id ini).
 * Kalau belum pernah dipakai sama sekali (baru dibuat), aman dihapus.
 *
 * Spreadsheet pribadi guru SENGAJA TIDAK ikut dihapus dari Drive di sini
 * — penghapusan file lewat kode tanpa konfirmasi eksplisit di UI terlalu
 * berisiko/tidak mudah dibatalkan, dan sekarang file itu ada di Drive
 * guru sendiri (bukan Drive Superadmin), jadi Superadmin memang tidak
 * bisa menghapusnya langsung. Hanya pemetaannya di RESOURCE_MAP yang
 * dilepas.
 */
function adminDeleteTeacher(guruId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_GURU');
  const guru = Utils_sheetToObjects_(sh).filter(function (r) { return r.guru_id === guruId; })[0];
  if (!guru) throw new Error('Guru tidak ditemukan.');

  const guruMapelCount = Utils_sheetToObjects_(Config_getSheet_('GURU_MAPEL')).filter(function (r) { return r.guru_id === guruId; }).length;
  const penugasanCount = Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR')).filter(function (r) { return r.guru_id === guruId; }).length;

  if (guruMapelCount > 0 || penugasanCount > 0) {
    throw new Error(
      'Guru tidak bisa dihapus permanen: masih punya ' + penugasanCount + ' penugasan mengajar dan ' +
      guruMapelCount + ' data mapel. Hapus dulu penugasannya, atau ubah status guru ini jadi NONAKTIF supaya histori tetap aman.'
    );
  }

  Utils_deleteRowById_(sh, 'guru_id', guruId);
  const mapSheet = Config_getSheet_('RESOURCE_MAP');
  if (Utils_findRowById_(mapSheet, 'guru_id', guruId) !== -1) {
    Utils_deleteRowById_(mapSheet, 'guru_id', guruId);
  }

  Auth_invalidateCache_(guru.email);
  AuditLog_write_(auth, 'DELETE_TEACHER', 'Guru', guruId, guru.email);
  return { ok: true };
}

/**
 * adminReprovisionTeacher(guruId)
 * SATU spreadsheet per guru, SELAMANYA — fungsi ini TIDAK PERNAH membuat
 * spreadsheet baru/pengganti (sempat begitu di versi sebelumnya, ditarik
 * lagi karena bikin ambigu: guru dan Superadmin bisa bingung spreadsheet
 * mana yang sebenarnya aktif dipakai kalau bisa ada lebih dari satu).
 * Yang dilakukan di sini:
 *  - Guru belum pernah login sama sekali (tidak ada RESOURCE_MAP): tidak
 *    ada yang perlu dilakukan, spreadsheet otomatis dibuat begitu guru
 *    itu login pertama kali (Guru_ensureOwnSpreadsheet_).
 *  - Guru sudah punya spreadsheet: (1) coba langsung beri akses EDITOR ke
 *    guru itu — berhasil kalau Superadmin yang mengklik tombol ini
 *    kebetulan pemilik/editor file itu (kasus paling umum: spreadsheet
 *    lama dari sebelum guru bisa provisi sendiri, masih dimiliki
 *    Superadmin), (2) flag needs_resync = 'YES' supaya akses ke
 *    Superadmin ikut disegarkan otomatis saat guru itu login berikutnya.
 */
function adminReprovisionTeacher(guruId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const existing = Guru_findResourceMapByGuruId_(guruId);
  if (!existing) {
    return { ok: true, note: 'Guru ini belum pernah login. Spreadsheet pribadinya akan dibuat otomatis, dimiliki akun Google guru itu sendiri, begitu dia login pertama kali.' };
  }

  let grantedDirectly = false;
  try {
    DriveApp.getFileById(existing.spreadsheet_id).addEditor(existing.email);
    grantedDirectly = true;
  } catch (eGrant) {
    Utils_logError_('REGRANT_GURU_ACCESS_' + guruId, eGrant);
  }

  Utils_updateRowByHeader_(Config_getSheet_('RESOURCE_MAP'), existing._row, { needs_resync: 'YES' });
  AuditLog_write_(auth, 'REPAIR_TEACHER_ACCESS', 'Guru', guruId, existing.spreadsheet_id);
  return {
    ok: true,
    note: grantedDirectly
      ? 'Akses guru ke spreadsheet-nya sudah diperbaiki langsung. Akses Superadmin juga akan disegarkan otomatis saat guru ini login berikutnya.'
      : 'Tidak bisa memberi akses langsung dari sini (kemungkinan Anda bukan editor/pemilik file itu) — tetap ditandai untuk disegarkan otomatis saat guru ini login berikutnya.'
  };
}

/**
 * adminGetTeacherSpreadsheetUrl(guruId)
 * SUPERADMIN only. Dipakai tombol "Buka Spreadsheet Guru" di UI — jalur
 * utama Superadmin memeriksa/memperbaiki data guru sekarang bahwa
 * datanya sudah dimiliki & dikelola guru sendiri (lihat catatan
 * arsitektur di atas berkas ini): buka langsung spreadsheet-nya di Sheets
 * (Superadmin sudah diberi akses Editor lewat Guru_grantSuperadminAccess_
 * saat provisioning), bukan lewat form admin terpisah lagi.
 */
function adminGetTeacherSpreadsheetUrl(guruId) {
  Security_requireRole_(['SUPERADMIN']);
  const entry = Guru_findResourceMapByGuruId_(guruId);
  if (!entry || !entry.spreadsheet_id) {
    throw new Error('Guru ini belum pernah login, jadi spreadsheet pribadinya belum ada.');
  }
  try {
    return { url: SpreadsheetApp.openById(entry.spreadsheet_id).getUrl() };
  } catch (e) {
    throw new Error('Belum punya akses ke spreadsheet guru ini. Klik "Tandai Perbaikan Akses" lalu minta guru tersebut login sekali lagi.');
  }
}

function Guru_findResourceMapByGuruId_(guruId) {
  const sh = Config_getSheet_('RESOURCE_MAP');
  const rows = Utils_sheetToObjects_(sh);
  return rows.filter(function (r) {
    return String(r.guru_id) === String(guruId) && String(r.status).toLowerCase() === 'active';
  })[0] || null;
}

/**
 * Guru_ensureOwnSpreadsheet_(guru, email)
 * Dipanggil dari Auth_resolve_ SETIAP KALI guru login — jadi selalu
 * berjalan SEBAGAI guru itu sendiri (executeAs: USER_ACCESSING).
 *
 * SATU spreadsheet per guru, SELAMANYA. Fungsi ini cuma boleh MEMBUAT
 * spreadsheet baru untuk guru yang BENAR-BENAR belum pernah punya satu
 * pun (belum ada RESOURCE_MAP aktif) — begitu satu sudah ada, fungsi ini
 * TIDAK PERNAH membuat/mengalihkan ke spreadsheet lain, walau
 * kepemilikannya masih di Superadmin (arsitektur lama). Sengaja ditarik
 * dari versi sebelumnya yang sempat auto-migrasi ke spreadsheet BARU
 * kalau file lama tidak terbaca — itu bikin ambigu (guru & Superadmin
 * bisa bingung mana yang sebenarnya sedang dipakai kalau ujung-ujungnya
 * bisa ada lebih dari satu "Data_Guru_..." per guru). Perbaikan akses ke
 * spreadsheet yang SUDAH ADA sekarang lewat dua jalur saja:
 *  - Superadmin klik "Tandai Perbaikan Akses" (adminReprovisionTeacher) —
 *    kalau Superadmin masih py akses ke file itu, bisa langsung
 *    memberi akses ke guru dari sana.
 *  - needs_resync (di-flag tombol di atas) dibaca di sini supaya akses
 *    balik ke Superadmin ikut disegarkan begitu guru itu login.
 *
 * Dibungkus try/catch total — kegagalan di sini TIDAK BOLEH membuat login
 * guru gagal total; kalau gagal, guru tetap bisa lanjut dengan data yang
 * sudah ada sebelumnya (atau dapat pesan jelas dari Config_getGuruSpreadsheet_
 * kalau memang belum pernah ada spreadsheet sama sekali).
 */
function Guru_ensureOwnSpreadsheet_(guru, email) {
  try {
    const entry = Guru_findResourceMapByGuruId_(guru.guru_id);

    if (!entry) {
      Guru_provisionSpreadsheet_(email, guru.guru_id, guru.nama_lengkap, guru.sekolah_id, guru);
      return Guru_findResourceMapByGuruId_(guru.guru_id);
    }

    if (String(entry.owned_by_guru).toUpperCase() !== 'YES') {
      try {
        const owner = DriveApp.getFileById(entry.spreadsheet_id).getOwner();
        if (owner && String(owner.getEmail()).toLowerCase().trim() === email) {
          Utils_updateRowByHeader_(Config_getSheet_('RESOURCE_MAP'), entry._row, { owned_by_guru: 'YES' });
        }
      } catch (eOwner) {
        // Tidak bisa baca info owner (jarang) -> lewati saja, tetap pakai
        // spreadsheet yang ada apa adanya, tidak membuat yang baru.
      }
      try { Guru_grantSuperadminAccess_(entry.spreadsheet_id); } catch (eGrant) {}
    } else if (String(entry.needs_resync).toUpperCase() === 'YES') {
      Guru_grantSuperadminAccess_(entry.spreadsheet_id);
      Utils_updateRowByHeader_(Config_getSheet_('RESOURCE_MAP'), entry._row, { needs_resync: '' });
    }

    Jadwal_migrateGuruToOwnSheetIfEmpty_(guru.guru_id, entry);

    return entry;
  } catch (e) {
    Utils_logError_('ENSURE_GURU_SPREADSHEET_' + guru.guru_id, e);
    return Guru_findResourceMapByGuruId_(guru.guru_id);
  }
}

/**
 * Guru_provisionSpreadsheet_(email, guruId, namaLengkap, sekolahId, data)
 * Buat spreadsheet pribadi guru + seluruh sheet operasional kosong
 * (header saja), lalu catat pemetaannya di RESOURCE_MAP. HARUS selalu
 * dipanggil dari eksekusi SEBAGAI guru itu sendiri (lihat
 * Guru_ensureOwnSpreadsheet_) supaya SpreadsheetApp.create() di bawah
 * menghasilkan file yang dimiliki akun guru itu, bukan Superadmin.
 */
function Guru_provisionSpreadsheet_(email, guruId, namaLengkap, sekolahId, data) {
  const slug = email.split('@')[0].replace(/[^a-z0-9]/gi, '_');
  const ss = SpreadsheetApp.create('Data_Guru_' + slug);
  const ssId = ss.getId();
  Guru_grantSuperadminAccess_(ssId);

  Object.keys(CONFIG_GURU_OPERATIONAL_SCHEMA_).forEach(function (name) {
    const headers = CONFIG_GURU_OPERATIONAL_SCHEMA_[name];
    const sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  });

  // Isi PROFIL awal. nip/no_hp diformat teks ('@') DULU sebelum ditulis —
  // No. HP Indonesia selalu berawalan 0 ("08xxxxxxxxxx"), yang tanpa ini
  // otomatis dibaca Sheets sebagai angka & kehilangan nol depannya begitu
  // baris ini ditulis (lihat Utils_normalizeNoHp_).
  const profilSheet = ss.getSheetByName('PROFIL');
  Config_applyTextFormat_(profilSheet, ['nip', 'no_hp']);
  Utils_appendRowByHeader_(profilSheet, {
    guru_id: guruId,
    email: email,
    nama_lengkap: namaLengkap,
    nip: (data && data.nip) || '',
    sekolah_id: sekolahId,
    jabatan: (data && data.jabatan) || 'Guru',
    no_hp: Utils_normalizeNoHp_(data && data.no_hp),
    foto_url: '',
    ttd_url: '',
    updated_at: new Date()
  });

  try {
    const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Lembar1');
    if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  } catch (e) {}

  const mapSheet = Config_getSheet_('RESOURCE_MAP');
  Utils_appendRowByHeader_(mapSheet, {
    id: Utils_newId_('RM'),
    guru_id: guruId,
    email: email,
    sekolah_id: sekolahId,
    spreadsheet_id: ssId,
    status: 'active',
    owned_by_guru: 'YES',
    needs_resync: '',
    // Guru baru tidak pernah punya jadwal lama di sheet central
    // JADWAL_MENGAJAR (arsitektur lama) untuk dimigrasikan — langsung
    // ditandai selesai supaya Jadwal_migrateGuruToOwnSheetIfEmpty_ tidak
    // perlu mengeceknya lagi di login-login berikutnya.
    jadwal_migrated: 'YES',
    created_at: new Date()
  });

  Auth_invalidateCache_(email);
  return ssId;
}

/**
 * Guru_grantSuperadminAccess_(spreadsheetId)
 * Dipanggil SEBAGAI GURU (pemilik file) untuk membagikan akses Editor ke
 * seluruh akun Superadmin aktif — supaya Superadmin tetap bisa membuka &
 * memperbaiki data guru itu kalau ada error, walau filenya sekarang
 * dimiliki guru sendiri (lihat permintaan: "jikalau ada error di sisi
 * guru, superadmin bisa mengecek database guru tersebut dan
 * memperbaikinya"). Setiap addEditor dibungkus try/catch sendiri-sendiri
 * supaya satu akun Superadmin yang gagal dibagikan tidak menggagalkan
 * yang lain.
 */
function Guru_grantSuperadminAccess_(spreadsheetId) {
  try {
    const file = DriveApp.getFileById(spreadsheetId);
    const admins = Utils_sheetToObjects_(Config_getSheet_('MASTER_SUPERADMIN')).filter(function (r) {
      return String(r.status || '').toLowerCase() === 'active' && r.email;
    });
    admins.forEach(function (a) {
      try { file.addEditor(String(a.email).toLowerCase().trim()); } catch (e) { Utils_logError_('GRANT_SUPERADMIN_ACCESS_' + spreadsheetId, e); }
    });
  } catch (e) {
    Utils_logError_('GRANT_SUPERADMIN_ACCESS_' + spreadsheetId, e);
  }
}

/**
 * Config_getGuruSpreadsheet_(guruId)
 * Resolve spreadsheet pribadi guru dari RESOURCE_MAP. TIDAK PERNAH
 * menerima spreadsheetId dari client — guruId di sini harus selalu
 * berasal dari auth server-side (getAuth().guruId), bukan parameter
 * request client, di SEMUA pemanggil.
 */
function Config_getGuruSpreadsheet_(guruId) {
  const entry = Guru_findResourceMapByGuruId_(guruId);
  if (!entry || !entry.spreadsheet_id) {
    throw new Error('Spreadsheet data Anda belum terprovisi. Hubungi Superadmin.');
  }
  return SpreadsheetApp.openById(entry.spreadsheet_id);
}
