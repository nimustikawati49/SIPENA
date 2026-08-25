// Guru.gs — CRUD MASTER_GURU + provisioning spreadsheet pribadi per guru.
// Provisioning dipicu eksplisit saat Superadmin "Tambah Guru" (bukan lazy
// saat login pertama) supaya guru baru langsung siap begitu login.

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
    nuptk: data.nuptk || '',
    sekolah_id: sekolahId,
    jabatan: data.jabatan || 'Guru',
    status: 'AKTIF',
    no_hp: data.no_hp || '',
    foto_url: '',
    ttd_url: '',
    created_at: new Date(),
    updated_at: new Date()
  });

  let spreadsheetId = '';
  try {
    spreadsheetId = Guru_provisionSpreadsheet_(email, guruId, namaLengkap, sekolahId, data);
  } catch (provErr) {
    // Guru tetap tercatat di MASTER_GURU walau provisioning gagal (mis.
    // kuota Drive) — spreadsheetId kosong di RESOURCE_MAP, bisa
    // diprovisikan ulang lewat adminReprovisionTeacher tanpa duplikasi.
    Utils_logError_('PROVISION_SPREADSHEET_FAILED_' + guruId, provErr);
  }

  AuditLog_write_(auth, 'CREATE_TEACHER', 'Guru', guruId, email + (spreadsheetId ? '' : ' (provisioning gagal, lihat _LOG_ERROR_)'));
  return { guru_id: guruId, spreadsheet_provisioned: !!spreadsheetId };
}

function adminUpdateTeacher(guruId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_GURU');
  const guru = Utils_sheetToObjects_(sh).filter(function (r) { return r.guru_id === guruId; })[0];
  if (!guru) throw new Error('Guru tidak ditemukan.');

  // guru_id, email, sekolah_id TIDAK boleh diubah lewat sini (walau oleh
  // Superadmin) demi konsistensi RESOURCE_MAP/PENUGASAN yang sudah
  // mereferensikannya — pindah sekolah/ganti email butuh alur mutasi
  // tersendiri, bukan edit biasa. NIP/NUPTK/jabatan boleh diubah karena
  // itu memang data administrasi yang dikelola Superadmin (spec §11).
  const patch = {};
  ['nama_lengkap', 'nip', 'nuptk', 'jabatan', 'status', 'no_hp'].forEach(function (k) {
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
 * berisiko/tidak mudah dibatalkan. Hanya pemetaannya di RESOURCE_MAP yang
 * dilepas; spreadsheet-nya tetap ada di Drive Superadmin kalau perlu
 * dibersihkan manual.
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
 * Coba lagi provisioning kalau gagal saat create (lihat try/catch di
 * atas). Idempoten: tidak membuat spreadsheet baru kalau RESOURCE_MAP
 * sudah punya entri aktif untuk guru ini.
 */
function adminReprovisionTeacher(guruId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  if (Guru_findResourceMapByGuruId_(guruId)) {
    return { ok: true, note: 'Sudah terprovisi sebelumnya.' };
  }
  const sh = Config_getSheet_('MASTER_GURU');
  const guru = Utils_sheetToObjects_(sh).filter(function (r) { return r.guru_id === guruId; })[0];
  if (!guru) throw new Error('Guru tidak ditemukan.');

  const spreadsheetId = Guru_provisionSpreadsheet_(guru.email, guru.guru_id, guru.nama_lengkap, guru.sekolah_id, {});
  AuditLog_write_(auth, 'REPROVISION_TEACHER', 'Guru', guruId, spreadsheetId);
  return { ok: true, spreadsheet_id: spreadsheetId };
}

function Guru_findResourceMapByGuruId_(guruId) {
  const sh = Config_getSheet_('RESOURCE_MAP');
  const rows = Utils_sheetToObjects_(sh);
  return rows.filter(function (r) {
    return String(r.guru_id) === String(guruId) && String(r.status).toLowerCase() === 'active';
  })[0] || null;
}

/**
 * Guru_provisionSpreadsheet_(email, guruId, namaLengkap, sekolahId, data)
 * Buat spreadsheet pribadi guru + seluruh sheet operasional kosong
 * (header saja), lalu catat pemetaannya di RESOURCE_MAP. Dipanggil sekali
 * saat guru dibuat (atau diulang lewat adminReprovisionTeacher).
 */
function Guru_provisionSpreadsheet_(email, guruId, namaLengkap, sekolahId, data) {
  const slug = email.split('@')[0].replace(/[^a-z0-9]/gi, '_');
  const ss = SpreadsheetApp.create('Data_Guru_' + slug);
  const ssId = ss.getId();

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
    nuptk: (data && data.nuptk) || '',
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
    created_at: new Date()
  });

  Auth_invalidateCache_(email);
  return ssId;
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
