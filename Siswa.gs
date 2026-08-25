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
 * adminGetImportTemplateUrl()
 * Template dibuat SEKALI (cached di Script Properties) dan dipakai ulang
 * — bukan file baru tiap klik, supaya Drive Superadmin tidak numpuk file
 * sampah. Format generik (tidak spesifik satu sekolah); nama kelas tetap
 * divalidasi ketat saat preview import (adminImportStudents), jadi
 * template tidak perlu tahu daftar kelas sekolah tertentu.
 */
function adminGetImportTemplateUrl() {
  Security_requireRole_(['SUPERADMIN']);
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('IMPORT_TEMPLATE_SPREADSHEET_ID');
  let ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { id = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('SIPENA - Template Import Siswa');
    const sh = ss.getActiveSheet();
    sh.setName('Import Siswa');
    sh.getRange(1, 1, 1, 4).setValues([['Kelas', 'NIS', 'Nama Lengkap', 'Jenis Kelamin (L/P)']]);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#4f46e5').setFontColor('#ffffff');
    sh.getRange(2, 1, 3, 4).setValues([
      ['7A', '1234', 'Contoh Nama Siswa Satu', 'L'],
      ['7A', '1235', 'Contoh Nama Siswa Dua', 'P'],
      ['7B', '1236', 'Contoh Nama Siswa Tiga', 'L']
    ]);
    sh.setFrozenRows(1);
    try { sh.autoResizeColumns(1, 4); } catch (e) {}
    id = ss.getId();
    props.setProperty('IMPORT_TEMPLATE_SPREADSHEET_ID', id);
  }
  const sh = ss.getSheetByName('Import Siswa') || ss.getSheets()[0];
  return { export_url: ss.getUrl().replace(/edit$/, 'export?format=xlsx&gid=' + sh.getSheetId()) };
}

/**
 * adminExportStudentsUrl(sekolahId)
 * Export "Daftar Siswa" lewat sheet helper di spreadsheet CENTRAL
 * (bukan bikin file baru tiap kali) — lihat Utils_writeExportSheetAndGetUrl_.
 */
function adminExportStudentsUrl(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const schoolById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_SEKOLAH')), 'sekolah_id');
  let rows = Utils_sheetToObjects_(Config_getSheet_('MASTER_SISWA'));
  if (sekolahId) rows = rows.filter(function (r) { return r.sekolah_id === sekolahId; });
  const dataRows = rows.map(function (r) {
    return [r.nis || '', r.nisn || '', r.nama_lengkap, (schoolById[r.sekolah_id] || {}).nama_sekolah || '-', r.jenis_kelamin || '', r.status];
  });
  const url = Utils_writeExportSheetAndGetUrl_(
    Config_getCentralSpreadsheet_(), '_EXPORT_SISWA',
    ['NIS', 'NISN', 'Nama Lengkap', 'Sekolah', 'JK', 'Status'], dataRows
  );
  return { export_url: url };
}

/**
 * adminImportStudents(sekolahId, rows)
 * Import massal — rows sudah divalidasi & di-preview di client
 * (SuperAdmin_previewImport_): [{nis, nisn, nama_lengkap, jenis_kelamin,
 * kelas_id}]. Bisa mencakup beberapa kelas/tingkat sekaligus (mis. impor
 * kelas 7-9 dalam satu tempel), karena kelas_id per baris sudah berbeda-
 * beda hasil pencocokan nama kelas di client.
 *
 * MASTER_SISWA ditulis dalam SATU batch. Kalau sekolah punya tahun
 * ajaran AKTIF (SEKOLAH_PERIODE_AKTIF), siswa juga langsung di-enroll
 * ke kelas masing-masing untuk periode itu (RIWAYAT_KELAS, batch juga)
 * — kalau belum ada periode aktif, siswa tetap dibuat (identitasnya),
 * enrollment dilewati dengan peringatan (bukan error) supaya Superadmin
 * bisa enroll manual nanti lewat "Kelola Siswa per Kelas".
 */
function adminImportStudents(sekolahId, rows) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  sekolahId = String(sekolahId || '').trim();
  if (!sekolahId) throw new Error('Sekolah wajib dipilih.');
  const cleanRows = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.nama_lengkap && r.kelas_id; });
  if (!cleanRows.length) throw new Error('Tidak ada data siswa yang valid untuk diimport.');

  const sh = Config_getSheet_('MASTER_SISWA');
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const now = new Date();
  const siswaRefs = [];

  const newSiswaRows = cleanRows.map(function (r) {
    const siswaId = Utils_newId_('SIS');
    siswaRefs.push({ siswa_id: siswaId, kelas_id: r.kelas_id });
    const obj = {
      siswa_id: siswaId, sekolah_id: sekolahId, nis: r.nis || '', nisn: r.nisn || '',
      nama_lengkap: r.nama_lengkap, jenis_kelamin: r.jenis_kelamin || '', tanggal_lahir: '', tahun_masuk: '',
      status: 'AKTIF', created_at: now, updated_at: now
    };
    return header.map(function (k) { return obj[k] === undefined ? '' : obj[k]; });
  });

  const startRow = sh.getLastRow() + 1;
  sh.getRange(startRow, 1, newSiswaRows.length, header.length).setValues(newSiswaRows);

  let enrolledCount = 0;
  let warning = '';
  const periode = TahunAjaran_getActivePeriod_(sekolahId);
  if (periode) {
    const rkSh = Config_getSheet_('RIWAYAT_KELAS');
    const rkHeader = rkSh.getRange(1, 1, 1, rkSh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
    const rkRows = siswaRefs.map(function (s) {
      const obj = {
        riwayat_id: Utils_newId_('RK'), siswa_id: s.siswa_id, sekolah_id: sekolahId,
        tahun_ajaran_id: periode.tahun_ajaran_id, semester: periode.semester, kelas_id: s.kelas_id,
        status: 'AKTIF', tanggal_mulai: now, tanggal_selesai: '', keterangan: 'Import massal'
      };
      return rkHeader.map(function (k) { return obj[k] === undefined ? '' : obj[k]; });
    });
    const rkStart = rkSh.getLastRow() + 1;
    rkSh.getRange(rkStart, 1, rkRows.length, rkHeader.length).setValues(rkRows);
    enrolledCount = rkRows.length;

    const affectedKelas = {};
    siswaRefs.forEach(function (s) { affectedKelas[s.kelas_id] = true; });
    Object.keys(affectedKelas).forEach(function (kelasId) { Siswa_syncTeachersForKelas_(kelasId, periode.tahun_ajaran_id, periode.semester); });
  } else {
    warning = 'Belum ada tahun ajaran aktif untuk sekolah ini — siswa dibuat tapi belum masuk kelas mana pun. Aktifkan tahun ajaran (tab Tahun Ajaran), lalu enroll manual lewat "Kelola Siswa per Kelas".';
  }

  AuditLog_write_(auth, 'IMPORT_STUDENTS', 'Siswa', sekolahId, cleanRows.length + ' siswa diimport' + (enrolledCount ? ', ' + enrolledCount + ' langsung enroll' : ''));
  return { created: cleanRows.length, enrolled: enrolledCount, warning: warning };
}

/**
 * adminGetStudentStats(sekolahId)
 * Total siswa AKTIF (identitas, MASTER_SISWA) vs total yang BENAR-BENAR
 * terdaftar di suatu kelas untuk periode aktif sekolah (RIWAYAT_KELAS) —
 * dua angka ini beda berarti ada siswa yang identitasnya sudah dibuat
 * tapi belum di-enroll ke kelas mana pun, tanda pendataan belum
 * lengkap. Plus breakdown per tingkat & per kelas untuk verifikasi
 * jumlah setelah import massal/kenaikan kelas.
 */
function adminGetStudentStats(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  sekolahId = String(sekolahId || '').trim();
  if (!sekolahId) throw new Error('Sekolah wajib dipilih.');

  const totalSiswaAktif = Utils_sheetToObjects_(Config_getSheet_('MASTER_SISWA')).filter(function (r) {
    return r.sekolah_id === sekolahId && String(r.status).toUpperCase() === 'AKTIF';
  }).length;

  const periode = TahunAjaran_getActivePeriod_(sekolahId);
  const perKelas = [];
  const perTingkatMap = {};
  let totalTerdaftarKelas = 0;

  if (periode) {
    const kelasById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')), 'kelas_id');
    const riwayat = Utils_sheetToObjects_(Config_getSheet_('RIWAYAT_KELAS')).filter(function (r) {
      return r.sekolah_id === sekolahId && r.tahun_ajaran_id === periode.tahun_ajaran_id &&
        r.semester === periode.semester && String(r.status).toUpperCase() === 'AKTIF';
    });

    const kelasCounts = {};
    riwayat.forEach(function (r) { kelasCounts[r.kelas_id] = (kelasCounts[r.kelas_id] || 0) + 1; });

    Object.keys(kelasCounts).forEach(function (kelasId) {
      const k = kelasById[kelasId] || {};
      const tingkat = String(k.tingkat || '?');
      perKelas.push({ kelas_id: kelasId, nama_kelas: k.nama_kelas || kelasId, tingkat: tingkat, jumlah: kelasCounts[kelasId] });
      perTingkatMap[tingkat] = (perTingkatMap[tingkat] || 0) + kelasCounts[kelasId];
      totalTerdaftarKelas += kelasCounts[kelasId];
    });
    perKelas.sort(function (a, b) { return String(a.nama_kelas).localeCompare(String(b.nama_kelas)); });
  }

  const perTingkat = Object.keys(perTingkatMap).sort().map(function (t) { return { tingkat: t, jumlah: perTingkatMap[t] }; });

  return {
    total_siswa_aktif: totalSiswaAktif,
    total_terdaftar_kelas: totalTerdaftarKelas,
    ada_periode_aktif: !!periode,
    per_tingkat: perTingkat,
    per_kelas: perKelas
  };
}

/**
 * adminGetEnrollment(kelasId, tahunAjaranId)
 * Dua daftar untuk UI "Kelola Siswa per Kelas": siswa yang SUDAH aktif
 * di kelas+periode ini, dan siswa sekolah yang sama yang BELUM (kandidat
 * untuk ditambahkan). Semester diturunkan dari tahunAjaranId, tidak
 * diminta terpisah (satu tahun_ajaran_id = satu label+semester).
 */
function adminGetEnrollment(kelasId, tahunAjaranId) {
  Security_requireRole_(['SUPERADMIN']);
  const kelas = Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  if (!kelas) throw new Error('Kelas tidak ditemukan.');
  const semester = TahunAjaran_getSemester_(tahunAjaranId);

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
 * adminEnrollStudents(kelasId, tahunAjaranId, siswaIds)
 * Batch tambah siswa ke kelas+periode ini (satu setValues, bukan satu
 * appendRow per siswa). Semester diturunkan dari tahunAjaranId. Kombinasi
 * yang sudah AKTIF dilewati, bukan error. Setelah itu sinkron ke SEMUA
 * guru yang mengajar kelas ini pada periode yang sama (roster SISWA di
 * spreadsheet mereka ikut ter-update).
 */
function adminEnrollStudents(kelasId, tahunAjaranId, siswaIds) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const kelas = Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  if (!kelas) throw new Error('Kelas tidak ditemukan.');
  const semester = TahunAjaran_getSemester_(tahunAjaranId);
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
