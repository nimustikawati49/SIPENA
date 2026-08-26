// Sekolah.gs — CRUD MASTER_SEKOLAH. Superadmin only.

function adminGetSchools() {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_SEKOLAH');
  return Utils_sheetToObjects_(sh).map(function (r) { delete r._row; return r; });
}

function adminCreateSchool(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const nama = String(data && data.nama_sekolah || '').trim();
  if (!nama) throw new Error('Nama sekolah wajib diisi.');
  const jenjang = String(data && data.jenjang || '').toUpperCase().trim();
  if (['SD', 'SMP', 'SMA', 'SMK'].indexOf(jenjang) === -1) {
    throw new Error('Jenjang harus salah satu dari SD, SMP, SMA, SMK.');
  }

  const sh = Config_getSheet_('MASTER_SEKOLAH');
  const sekolahId = Utils_newId_('SKL');
  Utils_appendRowByHeader_(sh, {
    sekolah_id: sekolahId,
    npsn: data.npsn || '',
    nama_sekolah: nama,
    jenjang: jenjang,
    alamat: data.alamat || '',
    desa: data.desa || '',
    kecamatan: data.kecamatan || '',
    kabupaten: data.kabupaten || '',
    provinsi: data.provinsi || '',
    kode_pos: data.kode_pos || '',
    email: data.email || '',
    telepon: data.telepon || '',
    website: data.website || '',
    nama_instansi: data.nama_instansi || '',
    nama_dinas: data.nama_dinas || '',
    status: 'AKTIF',
    created_at: new Date(),
    updated_at: new Date()
  });

  AuditLog_write_(auth, 'CREATE_SCHOOL', 'Sekolah', sekolahId, nama);
  return { sekolah_id: sekolahId };
}

/**
 * adminDeleteSchool(sekolahId)
 * Hard-delete HANYA kalau sekolah belum dipakai guru/kelas mana pun —
 * kalau sudah, tolak dan minta pengguna nonaktifkan (status) atau
 * pindahkan dulu referensinya, supaya tidak ada guru_id/kelas_id yang
 * jadi yatim menunjuk sekolah_id yang sudah tidak ada.
 */
function adminDeleteSchool(sekolahId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_SEKOLAH');
  const sekolah = Utils_sheetToObjects_(sh).filter(function (r) { return r.sekolah_id === sekolahId; })[0];
  if (!sekolah) throw new Error('Sekolah tidak ditemukan.');

  const guruCount = Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU'))
    .filter(function (r) { return r.sekolah_id === sekolahId; }).length;
  const kelasCount = Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS'))
    .filter(function (r) { return r.sekolah_id === sekolahId; }).length;

  if (guruCount > 0 || kelasCount > 0) {
    throw new Error(
      'Sekolah tidak bisa dihapus: masih dipakai oleh ' + guruCount + ' guru dan ' + kelasCount +
      ' kelas. Pindahkan/hapus dulu data itu, atau nonaktifkan saja sekolah ini (ubah status).'
    );
  }

  Utils_deleteRowById_(sh, 'sekolah_id', sekolahId);
  AuditLog_write_(auth, 'DELETE_SCHOOL', 'Sekolah', sekolahId, sekolah.nama_sekolah);
  return { ok: true };
}

function adminUpdateSchool(sekolahId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_SEKOLAH');
  const rowNum = Utils_findRowById_(sh, 'sekolah_id', sekolahId);
  if (rowNum === -1) throw new Error('Sekolah tidak ditemukan.');

  const patch = {};
  ['npsn', 'nama_sekolah', 'jenjang', 'alamat', 'desa', 'kecamatan', 'kabupaten', 'provinsi', 'kode_pos', 'email', 'telepon', 'website', 'nama_instansi', 'nama_dinas', 'status'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  patch.updated_at = new Date();
  Utils_updateRowByHeader_(sh, rowNum, patch);

  AuditLog_write_(auth, 'UPDATE_SCHOOL', 'Sekolah', sekolahId, JSON.stringify(patch));
  return { ok: true };
}

/**
 * Kop cetak — SEKOLAH_KOP (Superadmin only, guru cuma baca lewat
 * getMySekolahKopOptions di Print.gs). Kop disimpan sebagai GAMBAR utuh
 * yang diunggah Superadmin (bukan disusun dari field teks) — satu sekolah
 * boleh punya beberapa kop (mis. "Kop Resmi"/"Kop Sederhana"), guru pilih
 * salah satu saat cetak lewat preview. Sama pola Utils_saveUploadedFile_
 * yang sudah dipakai foto profil/tanda tangan.
 */
function adminGetSekolahKopList(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KOP_SHEET_, CONFIG_KOP_HEADERS_);
  let rows = Utils_sheetToObjects_(sh).map(function (r) { delete r._row; return r; });
  if (sekolahId) rows = rows.filter(function (r) { return r.sekolah_id === sekolahId; });
  return rows;
}

function adminUploadSekolahKop(sekolahId, namaKop, paperHint, base64Data, mimeType, fileName) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  if (!sekolahId) throw new Error('Pilih sekolah dulu.');
  const nama = String(namaKop || '').trim();
  if (!nama) throw new Error('Nama kop wajib diisi (mis. "Kop Resmi").');

  const url = Utils_saveUploadedFile_('SIPENA_Kop_Sekolah', base64Data, mimeType, fileName, 3000);
  const sh = Config_ensureCentralSheet_(CONFIG_KOP_SHEET_, CONFIG_KOP_HEADERS_);
  const kopId = Utils_newId_('KOP');
  Utils_appendRowByHeader_(sh, {
    kop_id: kopId, sekolah_id: sekolahId, nama_kop: nama, paper_hint: paperHint || '', image_url: url,
    status: 'AKTIF', created_at: new Date(), updated_at: new Date(), created_by: auth.email
  });

  AuditLog_write_(auth, 'UPLOAD_KOP', 'Sekolah', sekolahId, nama);
  return { kop_id: kopId, url: url };
}

/**
 * adminReplaceSekolahKopImage(kopId, base64Data, mimeType, fileName)
 * "Bisa direplace" — ganti gambar kop tanpa membuat entri baru, nama/paper
 * hint/kop_id tetap sama (guru yang sudah memilih kop ini otomatis lihat
 * gambar baru di cetakan berikutnya).
 */
function adminReplaceSekolahKopImage(kopId, base64Data, mimeType, fileName) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KOP_SHEET_, CONFIG_KOP_HEADERS_);
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.kop_id === kopId; })[0];
  if (!row) throw new Error('Kop tidak ditemukan.');

  const url = Utils_saveUploadedFile_('SIPENA_Kop_Sekolah', base64Data, mimeType, fileName, 3000);
  Utils_updateRowByHeader_(sh, row._row, { image_url: url, updated_at: new Date() });

  AuditLog_write_(auth, 'REPLACE_KOP_IMAGE', 'Sekolah', row.sekolah_id, row.nama_kop);
  return { url: url };
}

function adminUpdateSekolahKop(kopId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KOP_SHEET_, CONFIG_KOP_HEADERS_);
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.kop_id === kopId; })[0];
  if (!row) throw new Error('Kop tidak ditemukan.');

  const patch = {};
  ['nama_kop', 'paper_hint', 'status'].forEach(function (k) { if (data[k] !== undefined) patch[k] = data[k]; });
  patch.updated_at = new Date();
  Utils_updateRowByHeader_(sh, row._row, patch);

  AuditLog_write_(auth, 'UPDATE_KOP', 'Sekolah', row.sekolah_id, JSON.stringify(patch));
  return { ok: true };
}

function adminDeleteSekolahKop(kopId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KOP_SHEET_, CONFIG_KOP_HEADERS_);
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.kop_id === kopId; })[0];
  if (!row) throw new Error('Kop tidak ditemukan.');

  Utils_deleteRowById_(sh, 'kop_id', kopId);
  AuditLog_write_(auth, 'DELETE_KOP', 'Sekolah', row.sekolah_id, row.nama_kop);
  return { ok: true };
}

/**
 * adminGetBobotNilai(sekolahId) / adminSaveBobotNilai(...)
 * Bobot nilai akhir (harian/PTS/ASAS-ASAT) + mode perhitungan adalah
 * kebijakan akademik SEKOLAH, jadi diatur Superadmin di sini — bukan
 * per-guru — konsisten dengan pola SEKOLAH_PERIODE_AKTIF/MASTER_TAHUN_AJARAN
 * yang juga domain Superadmin. Dipakai oleh Nilai_getBobotConfig_
 * (Nilai.gs) saat menghitung Nilai Akhir guru.
 */
function adminGetBobotNilai(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  if (!sekolahId) throw new Error('Sekolah wajib dipilih.');
  return Nilai_getBobotConfig_(sekolahId);
}

function adminSaveBobotNilai(sekolahId, bobotHarian, bobotPts, bobotAkhirSemester, modePerhitungan, decimalPlaces) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  if (!sekolahId) throw new Error('Sekolah wajib dipilih.');

  bobotHarian = Number(bobotHarian); bobotPts = Number(bobotPts); bobotAkhirSemester = Number(bobotAkhirSemester);
  if ([bobotHarian, bobotPts, bobotAkhirSemester].some(function (v) { return isNaN(v) || v < 0 || v > 100; })) {
    throw new Error('Bobot harus angka 0–100.');
  }
  if (bobotHarian + bobotPts + bobotAkhirSemester !== 100) {
    throw new Error('Total bobot harus 100 (saat ini ' + (bobotHarian + bobotPts + bobotAkhirSemester) + ').');
  }
  if (NILAI_MODE_VALID_.indexOf(modePerhitungan) === -1) throw new Error('Mode perhitungan tidak valid.');
  decimalPlaces = Number(decimalPlaces);
  if (isNaN(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4) throw new Error('Angka desimal harus 0–4.');

  const sh = Config_ensureCentralSheet_(CONFIG_BOBOT_NILAI_SHEET_, CONFIG_BOBOT_NILAI_HEADERS_);
  const existing = Utils_sheetToObjects_(sh).filter(function (r) { return r.sekolah_id === sekolahId; })[0];
  const patch = {
    bobot_harian: bobotHarian, bobot_pts: bobotPts, bobot_akhir_semester: bobotAkhirSemester,
    mode_perhitungan: modePerhitungan, decimal_places: decimalPlaces,
    updated_at: new Date(), updated_by: auth.email
  };
  if (existing) {
    Utils_updateRowByHeader_(sh, existing._row, patch);
  } else {
    Utils_appendRowByHeader_(sh, Object.assign({ sekolah_id: sekolahId }, patch));
  }

  AuditLog_write_(auth, 'UPDATE_BOBOT_NILAI', 'Sekolah', sekolahId, JSON.stringify(patch));
  return { ok: true };
}
