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

function adminGetTeachers(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_GURU');
  const rows = Utils_sheetToObjects_(sh).map(function (r) { delete r._row; return r; });
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
    no_hp: data.no_hp || '',
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
 * Superadmin TIDAK BISA lagi membuat/menguasai ulang spreadsheet guru
 * secara langsung (kalau bisa, file itu akan kembali dimiliki Superadmin
 * — persis masalah arsitektur lama yang sedang diperbaiki). Yang bisa
 * dilakukan Superadmin dari sini:
 *  - Guru belum pernah login sama sekali (tidak ada RESOURCE_MAP): tidak
 *    ada yang perlu dilakukan, spreadsheet otomatis dibuat begitu guru
 *    itu login pertama kali.
 *  - Guru sudah pernah terprovisi tapi bermasalah (mis. Superadmin
 *    kehilangan akses lihat/perbaiki datanya): flag needs_resync = 'YES'
 *    di baris RESOURCE_MAP-nya. Baris ini dibaca ulang oleh
 *    Guru_ensureOwnSpreadsheet_ SAAT GURU ITU LOGIN BERIKUTNYA (dia
 *    pemilik file-nya, cuma dia yang bisa membagikan akses ke Superadmin)
 *    dan otomatis membagikan ulang akses ke seluruh Superadmin aktif.
 */
function adminReprovisionTeacher(guruId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const existing = Guru_findResourceMapByGuruId_(guruId);
  if (!existing) {
    return { ok: true, note: 'Guru ini belum pernah login. Spreadsheet pribadinya akan dibuat otomatis, dimiliki akun Google guru itu sendiri, begitu dia login pertama kali.' };
  }

  Utils_updateRowByHeader_(Config_getSheet_('RESOURCE_MAP'), existing._row, { needs_resync: 'YES' });
  AuditLog_write_(auth, 'FLAG_TEACHER_RESYNC', 'Guru', guruId, existing.spreadsheet_id);
  return { ok: true, note: 'Ditandai untuk perbaikan akses — akan otomatis dijalankan begitu guru ini login berikutnya (hanya pemilik file, yaitu guru itu sendiri, yang bisa membagikan akses).' };
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
 * berjalan SEBAGAI guru itu sendiri (executeAs: USER_ACCESSING). Ini satu-
 * satunya tempat yang boleh membuat spreadsheet baru untuk guru, karena
 * cuma di sinilah SpreadsheetApp.create() menghasilkan file yang dimiliki
 * akun guru itu sendiri.
 *
 * Tiga kondisi ditangani:
 *  1. Belum ada RESOURCE_MAP aktif -> guru baru, provisi dari nol.
 *  2. Ada, tapi belum pernah dikonfirmasi milik guru (owned_by_guru belum
 *     'YES') -> ini guru lama dari arsitektur SEBELUM perubahan ini,
 *     spreadsheet-nya masih dimiliki Superadmin. Cek owner file-nya lewat
 *     Drive: kalau ternyata sudah jadi milik guru (mis. baris ini sudah
 *     pernah diverifikasi tapi belum ditandai), tandai saja. Kalau
 *     memang masih milik Superadmin, migrasikan datanya ke spreadsheet
 *     BARU yang dimiliki guru (Guru_migrateToOwnAccount_).
 *  3. Sudah dikonfirmasi milik guru, tapi ditandai needs_resync (lihat
 *     adminReprovisionTeacher) -> bagikan ulang akses ke Superadmin.
 *
 * Dibungkus try/catch total — kegagalan di sini TIDAK BOLEH membuat login
 * guru gagal total; kalau gagal, guru tetap bisa lanjut dengan data yang
 * sudah ada sebelumnya (atau dapat pesan jelas dari Config_getGuruSpreadsheet_
 * kalau memang belum pernah ada spreadsheet sama sekali).
 */
function Guru_ensureOwnSpreadsheet_(guru, email) {
  try {
    let entry = Guru_findResourceMapByGuruId_(guru.guru_id);

    if (!entry) {
      Guru_provisionSpreadsheet_(email, guru.guru_id, guru.nama_lengkap, guru.sekolah_id, guru);
      return Guru_findResourceMapByGuruId_(guru.guru_id);
    }

    if (String(entry.owned_by_guru).toUpperCase() !== 'YES') {
      let ownedByGuru = false;
      try {
        const owner = DriveApp.getFileById(entry.spreadsheet_id).getOwner();
        ownedByGuru = !!owner && String(owner.getEmail()).toLowerCase().trim() === email;
      } catch (eOwner) {
        // Tidak bisa baca info owner (jarang) -> anggap belum, coba migrasi di bawah.
      }
      if (ownedByGuru) {
        Utils_updateRowByHeader_(Config_getSheet_('RESOURCE_MAP'), entry._row, { owned_by_guru: 'YES' });
        Guru_grantSuperadminAccess_(entry.spreadsheet_id);
      } else {
        const migrated = Guru_migrateToOwnAccount_(entry, guru, email);
        if (migrated) entry = migrated;
      }
    } else if (String(entry.needs_resync).toUpperCase() === 'YES') {
      Guru_grantSuperadminAccess_(entry.spreadsheet_id);
      Utils_updateRowByHeader_(Config_getSheet_('RESOURCE_MAP'), entry._row, { needs_resync: '' });
    }

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

  // Isi PROFIL awal.
  const profilSheet = ss.getSheetByName('PROFIL');
  Utils_appendRowByHeader_(profilSheet, {
    guru_id: guruId,
    email: email,
    nama_lengkap: namaLengkap,
    nip: (data && data.nip) || '',
    sekolah_id: sekolahId,
    jabatan: (data && data.jabatan) || 'Guru',
    no_hp: (data && data.no_hp) || '',
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
 * Guru_migrateToOwnAccount_(oldEntry, guru, email)
 * Guru lama yang spreadsheet-nya masih dimiliki Superadmin (arsitektur
 * sebelum perubahan ini): buat spreadsheet BARU yang dimiliki guru
 * (Guru_provisionSpreadsheet_, berjalan sebagai guru), salin semua data
 * dari spreadsheet lama ke yang baru, lalu alihkan RESOURCE_MAP ke yang
 * baru. Baris lama ditandai status 'migrated' (bukan dihapus) supaya
 * jejaknya tetap ada.
 *
 * Membaca spreadsheet lama makan akses EDITOR yang sudah (mestinya)
 * dibagikan ke guru ini sebelumnya (addEditor di arsitektur lama). Kalau
 * ternyata akses itu sendiri gagal/ditolak (skenario persis yang memicu
 * perubahan arsitektur ini), migrasi otomatis gagal dengan aman lewat
 * try/catch — guru tetap bisa lanjut pakai spreadsheet lamanya seperti
 * biasa (tidak ada regresi), tinggal dicoba lagi di login berikutnya.
 */
function Guru_migrateToOwnAccount_(oldEntry, guru, email) {
  try {
    const oldSs = SpreadsheetApp.openById(oldEntry.spreadsheet_id);
    const newSsId = Guru_provisionSpreadsheet_(email, guru.guru_id, guru.nama_lengkap, guru.sekolah_id, guru);
    const newSs = SpreadsheetApp.openById(newSsId);

    Object.keys(CONFIG_GURU_OPERATIONAL_SCHEMA_).forEach(function (name) {
      Guru_copySheetData_(oldSs, newSs, name);
    });
    // Jadwal mengajar guru ini sebelumnya tersimpan di sheet central
    // JADWAL_MENGAJAR (arsitektur lama), belum di sheet JADWAL pribadinya
    // — disalin terpisah karena strukturnya beda (lihat Jadwal.gs).
    Jadwal_migrateGuruToOwnSheet_(guru.guru_id, newSs);

    Utils_updateRowByHeader_(Config_getSheet_('RESOURCE_MAP'), oldEntry._row, { status: 'migrated' });
    Auth_invalidateCache_(email);
    return Guru_findResourceMapByGuruId_(guru.guru_id);
  } catch (e) {
    Utils_logError_('MIGRATE_GURU_ACCOUNT_' + guru.guru_id, e);
    return null;
  }
}

function Guru_copySheetData_(oldSs, newSs, sheetName) {
  const oldSh = oldSs.getSheetByName(sheetName);
  const newSh = newSs.getSheetByName(sheetName);
  if (!oldSh || !newSh) return;
  const lastRow = oldSh.getLastRow();
  if (lastRow < 2) return;
  const numCols = oldSh.getLastColumn();
  const values = oldSh.getRange(2, 1, lastRow - 1, numCols).getValues();
  newSh.getRange(2, 1, values.length, numCols).setValues(values);
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
