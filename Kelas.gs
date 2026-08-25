// Kelas.gs — CRUD MASTER_KELAS. Superadmin only.
//
// Termasuk GENERATOR ROMBEL OTOMATIS (Kelas_computeRombelPlan_ dkk. di
// bagian bawah file): buat banyak rombel dari TINGKAT + JUMLAH ROMBEL
// (dan PROGRAM/KONSENTRASI KEAHLIAN untuk SMK) tanpa Superadmin mengetik
// nama kelas satu per satu. Generator HANYA mengelola struktur MASTER_KELAS
// — tidak pernah menyentuh siswa/RIWAYAT_KELAS/kenaikan kelas, itu domain
// KenaikanKelas.gs (Phase 6). kelas_id tetap jadi identitas permanen;
// nama_kelas ("7A" dst.) bukan primary key dan boleh berulang lintas
// tahun ajaran karena MASTER_KELAS memang struktural (dipakai ulang tiap
// tahun — konteks per-tahun ada di RIWAYAT_KELAS/PENUGASAN_MENGAJAR).

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

/**
 * adminDeleteClass(kelasId)
 * Ditolak kalau masih dipakai di PENUGASAN_MENGAJAR mana pun.
 */
function adminDeleteClass(kelasId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('MASTER_KELAS');
  const kelas = Utils_sheetToObjects_(sh).filter(function (r) { return r.kelas_id === kelasId; })[0];
  if (!kelas) throw new Error('Kelas tidak ditemukan.');

  const penugasanCount = Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR'))
    .filter(function (r) { return r.kelas_id === kelasId; }).length;

  if (penugasanCount > 0) {
    throw new Error('Kelas tidak bisa dihapus: masih dipakai di ' + penugasanCount + ' penugasan mengajar. Hapus/ubah dulu penugasan itu.');
  }

  Utils_deleteRowById_(sh, 'kelas_id', kelasId);
  AuditLog_write_(auth, 'DELETE_CLASS', 'Kelas', kelasId, kelas.nama_kelas);
  return { ok: true };
}

// =========================================================
// GENERATOR ROMBEL OTOMATIS
// =========================================================

const KELAS_ROMBEL_LETTERS_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Kelas_rombelPrefix_(jenjang, tingkat, programKeahlian)
 * Non-SMK: "7" + "A" = "7A". SMK: "10 TKJ" + " " + "A" = "10 TKJ A".
 */
function Kelas_rombelPrefix_(jenjang, tingkat, programKeahlian) {
  if (jenjang === 'SMK' && programKeahlian) return tingkat + ' ' + programKeahlian + ' ';
  return tingkat;
}

/**
 * Kelas_computeRombelPlan_(params)
 * params: { sekolah_id, jenjang, tingkat, jumlah_rombel, program_keahlian? }
 * Hitung rencana tanpa menulis apa pun — dipakai baik untuk preview
 * (adminPreviewRombelBatch) maupun sebelum eksekusi nyata
 * (adminGenerateRombelBatch), supaya preview yang dilihat Superadmin
 * PERSIS sama dengan yang akan dieksekusi.
 *
 * Proteksi duplikat: rombel yang hurufnya sudah terpakai (dalam scope
 * sekolah+tingkat+program yang sama) tidak dibuat ulang — hanya huruf
 * yang belum ada yang masuk to_create. Pengurangan jumlah rombel tidak
 * pernah menghasilkan penghapusan — kelas yang hurufnya melebihi jumlah
 * baru masuk to_deactivate (status NONAKTIF), datanya (siswa/nilai/
 * penugasan/jadwal/histori apa pun yang mereferensikan kelas_id-nya)
 * tidak tersentuh sama sekali.
 */
function Kelas_computeRombelPlan_(params) {
  const sekolahId = String((params && params.sekolah_id) || '').trim();
  const jenjang = String((params && params.jenjang) || '').toUpperCase().trim();
  const tingkat = String((params && params.tingkat) || '').trim();
  const jumlahRombel = parseInt((params && params.jumlah_rombel), 10);
  const programKeahlian = String((params && params.program_keahlian) || '').trim();

  if (!sekolahId) throw new Error('Sekolah wajib dipilih.');
  if (['SD', 'SMP', 'SMA', 'SMK'].indexOf(jenjang) === -1) throw new Error('Jenjang tidak valid.');
  if (!tingkat) throw new Error('Tingkat wajib diisi.');
  if (!jumlahRombel || jumlahRombel < 1 || jumlahRombel > 26) throw new Error('Jumlah rombel harus 1–26 (kehabisan huruf A–Z di atas 26).');
  if (jenjang === 'SMK' && !programKeahlian) throw new Error('Program/Konsentrasi Keahlian wajib diisi untuk SMK.');

  const prefix = Kelas_rombelPrefix_(jenjang, tingkat, programKeahlian);
  const allInSchool = Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS'))
    .filter(function (r) { return r.sekolah_id === sekolahId; });

  const inScope = allInSchool.filter(function (r) {
    return String(r.tingkat) === tingkat && String(r.program_keahlian || '') === programKeahlian;
  });
  const existingByLetter = {};
  inScope.forEach(function (r) {
    const suffix = String(r.nama_kelas || '').slice(prefix.length);
    if (KELAS_ROMBEL_LETTERS_.indexOf(suffix) !== -1) existingByLetter[suffix] = r;
  });

  const allNamesInSchool = {};
  allInSchool.forEach(function (r) { allNamesInSchool[r.nama_kelas] = true; });

  const toCreate = [];
  const conflicts = [];
  for (let i = 0; i < jumlahRombel; i++) {
    const letter = KELAS_ROMBEL_LETTERS_[i];
    if (existingByLetter[letter]) continue;
    const namaKelas = prefix + letter;
    if (allNamesInSchool[namaKelas]) { conflicts.push(namaKelas); continue; }
    toCreate.push(namaKelas);
  }

  const toKeep = [];
  const toDeactivate = [];
  Object.keys(existingByLetter).forEach(function (letter) {
    const idx = KELAS_ROMBEL_LETTERS_.indexOf(letter);
    const row = existingByLetter[letter];
    if (idx < jumlahRombel) {
      toKeep.push(row.nama_kelas);
    } else if (String(row.status).toUpperCase() !== 'NONAKTIF') {
      toDeactivate.push({ kelas_id: row.kelas_id, nama_kelas: row.nama_kelas });
    }
  });

  return {
    sekolah_id: sekolahId, jenjang: jenjang, tingkat: tingkat, program_keahlian: programKeahlian,
    prefix: prefix, jumlah_rombel: jumlahRombel,
    existing: toKeep.sort(),
    to_create: toCreate,
    to_deactivate: toDeactivate,
    conflicts: conflicts
  };
}

/**
 * Kelas_applyRombelPlans_(auth, plans)
 * Eksekusi 1..N rencana SEKALIGUS dalam SATU setValues untuk seluruh
 * kelas baru (bukan satu appendRow per kelas, dan bukan satu request per
 * tingkat kalau generate banyak tingkat sekaligus) — mandat performa di
 * spec. Nonaktivasi tetap per-baris (jumlahnya biasanya sangat kecil per
 * generate, tidak signifikan dibanding pembuatan massal).
 */
function Kelas_applyRombelPlans_(auth, plans) {
  const sh = Config_getSheet_('MASTER_KELAS');
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').toLowerCase().trim(); });

  const newRows = [];
  plans.forEach(function (plan) {
    plan.to_create.forEach(function (namaKelas) {
      const obj = {
        kelas_id: Utils_newId_('KLS'), sekolah_id: plan.sekolah_id, tingkat: plan.tingkat,
        nama_kelas: namaKelas, jenjang: plan.jenjang, program_keahlian: plan.program_keahlian,
        konsentrasi_keahlian: '', status: 'AKTIF'
      };
      newRows.push(header.map(function (key) { return obj[key] === undefined ? '' : obj[key]; }));
    });
  });

  if (newRows.length) {
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, newRows.length, header.length).setValues(newRows);
  }

  plans.forEach(function (plan) {
    plan.to_deactivate.forEach(function (item) {
      const rowNum = Utils_findRowById_(sh, 'kelas_id', item.kelas_id);
      if (rowNum !== -1) Utils_updateRowByHeader_(sh, rowNum, { status: 'NONAKTIF' });
    });
  });

  plans.forEach(function (plan) {
    if (!plan.to_create.length && !plan.to_deactivate.length) return;
    AuditLog_write_(
      auth, 'GENERATE_ROMBEL', 'Kelas',
      plan.tingkat + (plan.program_keahlian ? ' ' + plan.program_keahlian : ''),
      'dibuat: ' + (plan.to_create.join(', ') || '-') + ' | dinonaktifkan: ' + (plan.to_deactivate.map(function (d) { return d.nama_kelas; }).join(', ') || '-')
    );
  });
}

/**
 * adminPreviewRombelBatch / adminGenerateRombelBatch
 * Ini satu-satunya jalur generator di UI — "satu tingkat" hanyalah kasus
 * khusus entries dengan 1 baris, jadi tidak perlu endpoint terpisah.
 * entries: [{ tingkat, jumlah_rombel, program_keahlian? }, ...] — satu
 * sekolah+jenjang, beberapa tingkat sekaligus ("Generate Semua Rombel").
 */
function adminPreviewRombelBatch(sekolahId, jenjang, entries) {
  Security_requireRole_(['SUPERADMIN']);
  return (entries || []).map(function (e) {
    return Kelas_computeRombelPlan_({
      sekolah_id: sekolahId, jenjang: jenjang, tingkat: e.tingkat,
      jumlah_rombel: e.jumlah_rombel, program_keahlian: e.program_keahlian
    });
  });
}

function adminGenerateRombelBatch(sekolahId, jenjang, entries) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const plans = (entries || []).map(function (e) {
    return Kelas_computeRombelPlan_({
      sekolah_id: sekolahId, jenjang: jenjang, tingkat: e.tingkat,
      jumlah_rombel: e.jumlah_rombel, program_keahlian: e.program_keahlian
    });
  });
  Kelas_applyRombelPlans_(auth, plans);
  return plans;
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
