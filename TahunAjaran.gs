// TahunAjaran.gs — Phase 2: hanya daftar tahun ajaran + status aktif per
// sekolah (SEKOLAH_PERIODE_AKTIF), dasar bagi Penugasan.gs. Workflow
// kenaikan kelas (request/approve/proses) ada di KenaikanKelas.gs, Phase 6.

function adminGetAcademicYears() {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_TAHUN_AJARAN');
  return Utils_sheetToObjects_(sh).map(function (r) { delete r._row; return r; });
}

function adminCreateAcademicYear(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const label = String(data && data.label || '').trim();
  const semester = String(data && data.semester || '').toUpperCase().trim();
  if (!label) throw new Error('Label tahun ajaran wajib diisi, mis. 2026/2027.');
  if (['GANJIL', 'GENAP'].indexOf(semester) === -1) throw new Error('Semester harus GANJIL atau GENAP.');

  const sh = Config_getSheet_('MASTER_TAHUN_AJARAN');
  const tahunAjaranId = Utils_newId_('TA');
  Utils_appendRowByHeader_(sh, {
    tahun_ajaran_id: tahunAjaranId,
    label: label,
    semester: semester,
    status: 'AKTIF'
  });

  AuditLog_write_(auth, 'CREATE_ACADEMIC_YEAR', 'TahunAjaran', tahunAjaranId, label + ' ' + semester);
  return { tahun_ajaran_id: tahunAjaranId };
}

function adminUpdateAcademicYear(tahunAjaranId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_TAHUN_AJARAN');
  const rowNum = Utils_findRowById_(sh, 'tahun_ajaran_id', tahunAjaranId);
  if (rowNum === -1) throw new Error('Tahun ajaran tidak ditemukan.');

  const patch = {};
  if (data.label !== undefined) patch.label = String(data.label).trim();
  if (data.semester !== undefined) {
    const semester = String(data.semester).toUpperCase().trim();
    if (['GANJIL', 'GENAP'].indexOf(semester) === -1) throw new Error('Semester harus GANJIL atau GENAP.');
    patch.semester = semester;
  }
  if (data.status !== undefined) patch.status = data.status;
  Utils_updateRowByHeader_(sh, rowNum, patch);

  AuditLog_write_(auth, 'UPDATE_ACADEMIC_YEAR', 'TahunAjaran', tahunAjaranId, JSON.stringify(patch));
  return { ok: true };
}

/**
 * adminDeleteAcademicYear(tahunAjaranId)
 * Ditolak kalau masih dipakai di GURU_MAPEL/PENUGASAN_MENGAJAR/
 * SEKOLAH_PERIODE_AKTIF mana pun.
 */
function adminDeleteAcademicYear(tahunAjaranId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_TAHUN_AJARAN');
  const ta = Utils_sheetToObjects_(sh).filter(function (r) { return r.tahun_ajaran_id === tahunAjaranId; })[0];
  if (!ta) throw new Error('Tahun ajaran tidak ditemukan.');

  const guruMapelCount = Utils_sheetToObjects_(Config_getSheet_('GURU_MAPEL')).filter(function (r) { return r.tahun_ajaran_id === tahunAjaranId; }).length;
  const penugasanCount = Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR')).filter(function (r) { return r.tahun_ajaran_id === tahunAjaranId; }).length;
  const periodeCount = Utils_sheetToObjects_(Config_getSheet_('SEKOLAH_PERIODE_AKTIF')).filter(function (r) { return r.tahun_ajaran_id === tahunAjaranId; }).length;

  if (guruMapelCount > 0 || penugasanCount > 0 || periodeCount > 0) {
    throw new Error(
      'Tahun ajaran tidak bisa dihapus: dipakai di ' + penugasanCount + ' penugasan, ' + guruMapelCount +
      ' data guru-mapel, dan diaktifkan di ' + periodeCount + ' sekolah.'
    );
  }

  Utils_deleteRowById_(sh, 'tahun_ajaran_id', tahunAjaranId);
  AuditLog_write_(auth, 'DELETE_ACADEMIC_YEAR', 'TahunAjaran', tahunAjaranId, ta.label + ' ' + ta.semester);
  return { ok: true };
}

/**
 * adminSetActivePeriod(sekolahId, tahunAjaranId)
 * Set periode aktif SATU sekolah — tidak menyentuh sekolah lain (mandat
 * "tiap sekolah bisa aktifkan tahun ajaran di tanggal berbeda").
 */
function adminSetActivePeriod(sekolahId, tahunAjaranId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  if (!sekolahId || !tahunAjaranId) throw new Error('Sekolah dan tahun ajaran wajib dipilih.');

  const taSheet = Config_getSheet_('MASTER_TAHUN_AJARAN');
  const taRows = Utils_sheetToObjects_(taSheet);
  const ta = taRows.filter(function (r) { return r.tahun_ajaran_id === tahunAjaranId; })[0];
  if (!ta) throw new Error('Tahun ajaran tidak ditemukan.');

  const sh = Config_getSheet_('SEKOLAH_PERIODE_AKTIF');
  const rows = Utils_sheetToObjects_(sh);
  const existing = rows.filter(function (r) { return String(r.sekolah_id) === String(sekolahId); })[0];

  if (existing) {
    Utils_updateRowByHeader_(sh, existing._row, {
      tahun_ajaran_id: tahunAjaranId,
      semester: ta.semester,
      status: 'AKTIF',
      activated_at: new Date(),
      activated_by: auth.email
    });
  } else {
    Utils_appendRowByHeader_(sh, {
      sekolah_id: sekolahId,
      tahun_ajaran_id: tahunAjaranId,
      semester: ta.semester,
      status: 'AKTIF',
      activated_at: new Date(),
      activated_by: auth.email
    });
  }

  AuditLog_write_(auth, 'SET_ACTIVE_PERIOD', 'TahunAjaran', tahunAjaranId, 'sekolah_id=' + sekolahId);
  return { ok: true };
}

function TahunAjaran_getActivePeriod_(sekolahId) {
  const sh = Config_getSheet_('SEKOLAH_PERIODE_AKTIF');
  const rows = Utils_sheetToObjects_(sh);
  return rows.filter(function (r) {
    return String(r.sekolah_id) === String(sekolahId) && String(r.status).toUpperCase() === 'AKTIF';
  })[0] || null;
}

function adminGetActivePeriod(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  return TahunAjaran_getActivePeriod_(sekolahId);
}
