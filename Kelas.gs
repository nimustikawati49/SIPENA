// Kelas.gs — CRUD MASTER_KELAS. Superadmin only.

function adminGetClasses(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_KELAS');
  const rows = Utils_sheetToObjects_(sh).map(function (r) { delete r._row; return r; });
  if (!sekolahId) return rows;
  return rows.filter(function (r) { return String(r.sekolah_id) === String(sekolahId); });
}

function adminCreateClass(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sekolahId = String(data && data.sekolah_id || '').trim();
  const namaKelas = String(data && data.nama_kelas || '').trim();
  if (!sekolahId) throw new Error('Sekolah wajib dipilih.');
  if (!namaKelas) throw new Error('Nama kelas wajib diisi.');

  const sh = Config_getSheet_('MASTER_KELAS');
  const kelasId = Utils_newId_('KLS');
  Utils_appendRowByHeader_(sh, {
    kelas_id: kelasId,
    sekolah_id: sekolahId,
    tingkat: data.tingkat || '',
    nama_kelas: namaKelas,
    jenjang: String(data.jenjang || '').toUpperCase(),
    program_keahlian: data.program_keahlian || '',
    konsentrasi_keahlian: data.konsentrasi_keahlian || '',
    status: 'AKTIF'
  });

  AuditLog_write_(auth, 'CREATE_CLASS', 'Kelas', kelasId, namaKelas);
  return { kelas_id: kelasId };
}

function adminUpdateClass(kelasId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_KELAS');
  const rowNum = Utils_findRowById_(sh, 'kelas_id', kelasId);
  if (rowNum === -1) throw new Error('Kelas tidak ditemukan.');

  const patch = {};
  ['tingkat', 'nama_kelas', 'jenjang', 'program_keahlian', 'konsentrasi_keahlian', 'status'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  Utils_updateRowByHeader_(sh, rowNum, patch);

  AuditLog_write_(auth, 'UPDATE_CLASS', 'Kelas', kelasId, JSON.stringify(patch));
  return { ok: true };
}
