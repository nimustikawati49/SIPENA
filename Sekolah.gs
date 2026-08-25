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
 * adminUploadSchoolLogo(sekolahId, jenis, base64Data, mimeType, fileName)
 * jenis: 'sekolah' | 'pemerintah'. Sama pola Utils_saveUploadedFile_ yang
 * sudah dipakai foto profil/tanda tangan — file tersimpan di Drive
 * Superadmin yang mengunggah (executeAs USER_ACCESSING), dibagikan
 * "siapa saja yang punya link boleh lihat" supaya bisa langsung dipakai
 * sebagai <img src> di kop cetak.
 */
function adminUploadSchoolLogo(sekolahId, jenis, base64Data, mimeType, fileName) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  if (['sekolah', 'pemerintah'].indexOf(jenis) === -1) throw new Error('Jenis logo tidak valid.');
  const sh = Config_getSheet_('MASTER_SEKOLAH');
  const rowNum = Utils_findRowById_(sh, 'sekolah_id', sekolahId);
  if (rowNum === -1) throw new Error('Sekolah tidak ditemukan.');

  const url = Utils_saveUploadedFile_('SIPENA_Logo_Sekolah', base64Data, mimeType, fileName, 800);
  const field = jenis === 'sekolah' ? 'logo_sekolah_url' : 'logo_pemerintah_url';
  const patch = {}; patch[field] = url; patch.updated_at = new Date();
  Utils_updateRowByHeader_(sh, rowNum, patch);

  AuditLog_write_(auth, 'UPDATE_SCHOOL_LOGO', 'Sekolah', sekolahId, field);
  return { url: url };
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
