// Auth.gs — resolusi identitas & role. Tidak ada form login: identitas
// selalu berasal dari Session.getEffectiveUser() (Google Workspace SSO).
// Role SELALU diturunkan ulang di server tiap panggilan (lewat cache
// pendek) — client tidak pernah mengirim guru_id/sekolah_id/role sebagai
// input yang dipercaya.

/**
 * getAuth()
 * Satu-satunya entry point publik untuk resolusi auth, dipanggil dari
 * scripts-init.html saat boot. Dipakai juga secara internal oleh
 * Security_requireAuth_().
 */
function getAuth() {
  const email = Auth_currentEmail_();
  if (!email) {
    return { authenticated: false, role: null, message: 'Tidak dapat membaca identitas Google Anda.' };
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = 'AUTH_' + email;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const auth = Auth_resolve_(email);
  try { cache.put(cacheKey, JSON.stringify(auth), 30); } catch (e) {}
  return auth;
}

function Auth_currentEmail_() {
  try {
    return String(Session.getEffectiveUser().getEmail() || '').toLowerCase().trim();
  } catch (e) {
    return '';
  }
}

function Auth_invalidateCache_(email) {
  try { CacheService.getScriptCache().remove('AUTH_' + String(email || '').toLowerCase().trim()); } catch (e) {}
}

/**
 * Auth_resolve_(email)
 * Urutan resolusi: MASTER_SUPERADMIN -> MASTER_GURU -> tidak terdaftar.
 * Tidak pernah auto-register email baru sebagai GURU (beda sengaja dari
 * SAG yang auto-trial-register) — akun guru wajib dibuat manual oleh
 * Superadmin (spec §10-11).
 */
function Auth_resolve_(email) {
  const superadmin = Auth_findSuperadmin_(email);
  if (superadmin) {
    return {
      authenticated: true,
      email: email,
      role: 'SUPERADMIN',
      nama: superadmin.nama || email,
      status: superadmin.status || 'active',
      fotoUrl: superadmin.foto_url || ''
    };
  }

  const guru = Auth_findGuru_(email);
  if (guru) {
    if (String(guru.status || '').toUpperCase() !== 'AKTIF') {
      return { authenticated: true, email: email, role: null, message: 'Akun Anda berstatus nonaktif. Hubungi Superadmin.' };
    }
    const resourceMap = Auth_findResourceMap_(guru.guru_id);
    return {
      authenticated: true,
      email: email,
      role: 'GURU',
      guruId: guru.guru_id,
      sekolahId: guru.sekolah_id,
      namaLengkap: guru.nama_lengkap,
      jabatan: guru.jabatan,
      namaSekolah: Auth_findSekolahNama_(guru.sekolah_id),
      spreadsheetId: resourceMap ? resourceMap.spreadsheet_id : ''
    };
  }

  return {
    authenticated: true,
    email: email,
    role: null,
    message: 'Akun belum terdaftar. Hubungi Superadmin.'
  };
}

function Auth_findSuperadmin_(email) {
  const sh = Config_getSheet_('MASTER_SUPERADMIN');
  const rows = Utils_sheetToObjects_(sh);

  if (rows.length === 0 && email === CONFIG_SUPERADMIN_BOOTSTRAP_EMAIL) {
    // Bootstrap sekali: sheet masih kosong, email ini dipercaya sebagai
    // superadmin pertama, lalu ditulis jadi baris resmi supaya login
    // berikutnya (email ini atau siapa pun) lewat jalur normal.
    sh.appendRow([email, 'Superadmin', 'active', new Date()]);
    return { email: email, nama: 'Superadmin', status: 'active' };
  }

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].email || '').toLowerCase().trim() === email && String(rows[i].status || '').toLowerCase() === 'active') {
      return rows[i];
    }
  }
  return null;
}

function Auth_findGuru_(email) {
  const sh = Config_getSheet_('MASTER_GURU');
  const rows = Utils_sheetToObjects_(sh);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].email || '').toLowerCase().trim() === email) return rows[i];
  }
  return null;
}

function Auth_findSekolahNama_(sekolahId) {
  if (!sekolahId) return '';
  const sh = Config_getSheet_('MASTER_SEKOLAH');
  const rows = Utils_sheetToObjects_(sh);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sekolah_id === sekolahId) return rows[i].nama_sekolah || '';
  }
  return '';
}

/**
 * updateMySuperadminProfile(nama) / uploadSuperadminPhoto(...)
 * SUPERADMIN mengedit profilnya SENDIRI (dicari by email dari sesi,
 * tidak pernah dari parameter client) — nama tampilan & foto. Superadmin
 * tidak punya NIP/No.HP di skema (itu properti guru), jadi
 * memang tidak ada field itu untuk role ini.
 */
function updateMySuperadminProfile(nama) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  nama = String(nama || '').trim();
  if (!nama) throw new Error('Nama wajib diisi.');

  const sh = Config_getSheet_('MASTER_SUPERADMIN');
  const rows = Utils_sheetToObjects_(sh);
  const row = rows.filter(function (r) { return String(r.email).toLowerCase() === auth.email; })[0];
  if (!row) throw new Error('Data Superadmin tidak ditemukan.');

  Utils_updateRowByHeader_(sh, row._row, { nama: nama });
  Auth_invalidateCache_(auth.email);
  AuditLog_write_(auth, 'UPDATE_SUPERADMIN_PROFILE', 'Profil', auth.email, nama);
  return { ok: true };
}

function uploadSuperadminPhoto(base64Data, mimeType, fileName) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const url = Utils_saveUploadedFile_('SIPENA_Foto_Profil', base64Data, mimeType, fileName);

  const sh = Config_getSheet_('MASTER_SUPERADMIN');
  const rows = Utils_sheetToObjects_(sh);
  const row = rows.filter(function (r) { return String(r.email).toLowerCase() === auth.email; })[0];
  if (!row) throw new Error('Data Superadmin tidak ditemukan.');

  Utils_updateRowByHeader_(sh, row._row, { foto_url: url });
  Auth_invalidateCache_(auth.email);
  AuditLog_write_(auth, 'UPDATE_SUPERADMIN_PHOTO', 'Profil', auth.email, url);
  return { url: url };
}

function Auth_findResourceMap_(guruId) {
  const sh = Config_getSheet_('RESOURCE_MAP');
  const rows = Utils_sheetToObjects_(sh);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].guru_id || '') === String(guruId) && String(rows[i].status || '').toLowerCase() === 'active') {
      return rows[i];
    }
  }
  return null;
}
