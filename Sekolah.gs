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
    status: 'AKTIF',
    created_at: new Date(),
    updated_at: new Date()
  });

  AuditLog_write_(auth, 'CREATE_SCHOOL', 'Sekolah', sekolahId, nama);
  return { sekolah_id: sekolahId };
}

function adminUpdateSchool(sekolahId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_SEKOLAH');
  const rowNum = Utils_findRowById_(sh, 'sekolah_id', sekolahId);
  if (rowNum === -1) throw new Error('Sekolah tidak ditemukan.');

  const patch = {};
  ['npsn', 'nama_sekolah', 'jenjang', 'alamat', 'desa', 'kecamatan', 'kabupaten', 'provinsi', 'status'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  patch.updated_at = new Date();
  Utils_updateRowByHeader_(sh, rowNum, patch);

  AuditLog_write_(auth, 'UPDATE_SCHOOL', 'Sekolah', sekolahId, JSON.stringify(patch));
  return { ok: true };
}
