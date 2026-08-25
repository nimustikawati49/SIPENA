// Siswa.gs — CRUD MASTER_SISWA + pengelolaan roster per kelas
// (RIWAYAT_KELAS). Superadmin only. Fondasi minimal untuk Phase 4
// (Nilai) bisa punya siswa nyata untuk dipilih — fitur pindahan/mutasi/
// kenaikan kelas penuh tetap Phase 6, belum dibangun di sini.
//
// Prinsip non-destruktif (spec §17): status siswa/riwayat DIUBAH
// (AKTIF/NONAKTIF/dst.), tidak pernah baris histori dihapus begitu
// siswa itu pernah benar-benar terdaftar di suatu kelas+periode.

function adminGetStudents(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const rows = Utils_sheetToObjects_(Config_getSheet_('MASTER_SISWA')).map(function (r) { delete r._row; return r; });
  if (!sekolahId) return rows;
  return rows.filter(function (r) { return String(r.sekolah_id) === String(sekolahId); });
}

function adminCreateStudent(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sekolahId = String(data && data.sekolah_id || '').trim();
  const namaLengkap = String(data && data.nama_lengkap || '').trim();
  if (!sekolahId) throw new Error('Sekolah wajib dipilih.');
  if (!namaLengkap) throw new Error('Nama siswa wajib diisi.');

  const siswaId = Utils_newId_('SIS');
  Utils_appendRowByHeader_(Config_getSheet_('MASTER_SISWA'), {
    siswa_id: siswaId,
    sekolah_id: sekolahId,
    nis: data.nis || '',
    nisn: data.nisn || '',
    nama_lengkap: namaLengkap,
    jenis_kelamin: data.jenis_kelamin || '',
    tanggal_lahir: data.tanggal_lahir || '',
    tahun_masuk: data.tahun_masuk || '',
    status: 'AKTIF',
    created_at: new Date(),
    updated_at: new Date()
  });

  AuditLog_write_(auth, 'CREATE_STUDENT', 'Siswa', siswaId, namaLengkap);
  return { siswa_id: siswaId };
}

function adminUpdateStudent(siswaId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_SISWA');
  const rowNum = Utils_findRowById_(sh, 'siswa_id', siswaId);
  if (rowNum === -1) throw new Error('Siswa tidak ditemukan.');

  const patch = {};
  ['nis', 'nisn', 'nama_lengkap', 'jenis_kelamin', 'tanggal_lahir', 'tahun_masuk', 'status'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  patch.updated_at = new Date();
  Utils_updateRowByHeader_(sh, rowNum, patch);

  AuditLog_write_(auth, 'UPDATE_STUDENT', 'Siswa', siswaId, JSON.stringify(patch));
  return { ok: true };
}

/**
 * adminDeleteStudent(siswaId)
 * Hard-delete HANYA kalau siswa belum pernah punya riwayat kelas sama
 * sekali (murni salah input, belum terdaftar di kelas mana pun) — begitu
 * ada RIWAYAT_KELAS yang mereferensikannya, tolak dan minta nonaktifkan
 * saja (mandat "jangan hapus histori siswa").
 */
function adminDeleteStudent(siswaId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_SISWA');
  const siswa = Utils_sheetToObjects_(sh).filter(function (r) { return r.siswa_id === siswaId; })[0];
  if (!siswa) throw new Error('Siswa tidak ditemukan.');

  const riwayatCount = Utils_sheetToObjects_(Config_getSheet_('RIWAYAT_KELAS'))
    .filter(function (r) { return r.siswa_id === siswaId; }).length;
  if (riwayatCount > 0) {
    throw new Error('Siswa tidak bisa dihapus permanen: sudah punya ' + riwayatCount + ' riwayat kelas. Ubah status jadi NONAKTIF saja supaya histori tetap aman.');
  }

  Utils_deleteRowById_(sh, 'siswa_id', siswaId);
  AuditLog_write_(auth, 'DELETE_STUDENT', 'Siswa', siswaId, siswa.nama_lengkap);
  return { ok: true };
}

/**
 * adminGetEnrollment(kelasId, tahunAjaranId, semester)
 * Dua daftar untuk UI "Kelola Siswa per Kelas": siswa yang SUDAH aktif
 * di kelas+periode ini, dan siswa sekolah yang sama yang BELUM (kandidat
 * untuk ditambahkan).
 */
function adminGetEnrollment(kelasId, tahunAjaranId, semester) {
  Security_requireRole_(['SUPERADMIN']);
  const kelas = Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  if (!kelas) throw new Error('Kelas tidak ditemukan.');

  const riwayat = Utils_sheetToObjects_(Config_getSheet_('RIWAYAT_KELAS')).filter(function (r) {
    return r.kelas_id === kelasId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester &&
      String(r.status).toUpperCase() === 'AKTIF';
  });
  const enrolledIds = {};
  riwayat.forEach(function (r) { enrolledIds[r.siswa_id] = r.riwayat_id; });

  const allStudents = Utils_sheetToObjects_(Config_getSheet_('MASTER_SISWA')).filter(function (r) {
    return r.sekolah_id === kelas.sekolah_id && String(r.status).toUpperCase() === 'AKTIF';
  });

  const enrolled = allStudents.filter(function (s) { return enrolledIds[s.siswa_id]; })
    .map(function (s) { return Object.assign({}, s, { riwayat_id: enrolledIds[s.siswa_id] }); });
  const notEnrolled = allStudents.filter(function (s) { return !enrolledIds[s.siswa_id]; });

  return { enrolled: enrolled, not_enrolled: notEnrolled };
}

/**
 * adminEnrollStudents(kelasId, tahunAjaranId, semester, siswaIds)
 * Batch tambah siswa ke kelas+periode ini (satu setValues, bukan satu
 * appendRow per siswa). Kombinasi yang sudah AKTIF dilewati, bukan
 * error. Setelah itu sinkron ke SEMUA guru yang mengajar kelas ini pada
 * periode yang sama (roster SISWA di spreadsheet mereka ikut ter-update).
 */
function adminEnrollStudents(kelasId, tahunAjaranId, semester, siswaIds) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const kelas = Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  if (!kelas) throw new Error('Kelas tidak ditemukan.');
  const ids = (Array.isArray(siswaIds) ? siswaIds : []).map(function (s) { return String(s || '').trim(); }).filter(function (s) { return s; });
  if (!ids.length) throw new Error('Pilih minimal satu siswa.');

  const sh = Config_getSheet_('RIWAYAT_KELAS');
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').toLowerCase().trim(); });

  const existingKeys = {};
  Utils_sheetToObjects_(sh).forEach(function (r) {
    if (String(r.status).toUpperCase() === 'AKTIF') {
      existingKeys[[r.siswa_id, r.kelas_id, r.tahun_ajaran_id, r.semester].join('|')] = true;
    }
  });

  const newRows = [];
  const added = [];
  const skipped = [];
  ids.forEach(function (siswaId) {
    const key = [siswaId, kelasId, tahunAjaranId, semester].join('|');
    if (existingKeys[key]) { skipped.push(siswaId); return; }
    const obj = {
      riwayat_id: Utils_newId_('RK'), siswa_id: siswaId, sekolah_id: kelas.sekolah_id,
      tahun_ajaran_id: tahunAjaranId, semester: semester, kelas_id: kelasId, status: 'AKTIF',
      tanggal_mulai: new Date(), tanggal_selesai: '', keterangan: ''
    };
    newRows.push(header.map(function (k) { return obj[k] === undefined ? '' : obj[k]; }));
    added.push(siswaId);
  });

  if (newRows.length) {
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, newRows.length, header.length).setValues(newRows);
  }

  if (added.length) {
    AuditLog_write_(auth, 'ENROLL_STUDENTS', 'RiwayatKelas', kelasId, 'siswa: ' + added.join(', '));
    Siswa_syncTeachersForKelas_(kelasId, tahunAjaranId, semester);
  }
  return { added: added, skipped: skipped };
}

/**
 * adminUpdateEnrollmentStatus(riwayatId, status)
 * Ubah status satu baris riwayat (mis. keluarkan dari roster aktif lewat
 * status NONAKTIF) — TIDAK PERNAH menghapus baris (histori siswa wajib
 * tetap ada, sesuai mandat spec).
 */
function adminUpdateEnrollmentStatus(riwayatId, status) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('RIWAYAT_KELAS');
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.riwayat_id === riwayatId; })[0];
  if (!row) throw new Error('Data riwayat kelas tidak ditemukan.');

  const patch = { status: status };
  if (String(status).toUpperCase() !== 'AKTIF') patch.tanggal_selesai = new Date();
  Utils_updateRowByHeader_(sh, row._row, patch);

  AuditLog_write_(auth, 'UPDATE_ENROLLMENT_STATUS', 'RiwayatKelas', riwayatId, status);
  Siswa_syncTeachersForKelas_(row.kelas_id, row.tahun_ajaran_id, row.semester);
  return { ok: true };
}

/**
 * Siswa_syncTeachersForKelas_(kelasId, tahunAjaranId, semester)
 * Cari semua guru AKTIF yang mengajar kelas+periode ini lewat
 * PENUGASAN_MENGAJAR, lalu sinkron roster SISWA mereka masing-masing.
 */
function Siswa_syncTeachersForKelas_(kelasId, tahunAjaranId, semester) {
  const guruIds = {};
  Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR')).forEach(function (r) {
    if (r.kelas_id === kelasId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester &&
      String(r.status).toUpperCase() === 'AKTIF') {
      guruIds[r.guru_id] = true;
    }
  });
  Object.keys(guruIds).forEach(function (guruId) { Sync_teacherData_(guruId); });
}
