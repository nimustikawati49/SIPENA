// Kktp.gs — KKTP (Kriteria Ketercapaian Tujuan Pembelajaran). Konfigurasi
// akademik milik SEKOLAH (diatur Superadmin), dibaca guru untuk menentukan
// kategori & status ketercapaian Nilai Akhir siswa. Sheet MASTER_KKTP
// central dibuat LAZY hanya dari fungsi admin* di file ini (semuanya
// Security_requireRole_(['SUPERADMIN']) di baris pertama) — TIDAK PERNAH
// insertSheet dari eksekusi guru (lihat catatan panjang di Config.gs soal
// CONFIG_BOBOT_NILAI_SHEET_, penyebab getAuth() sempat gagal total untuk
// guru saat sheet central baru dibuat lazy dari konteks yang salah).

const KKTP_INTERVAL_LABELS_DEFAULT_ = ['Belum Mencapai', 'Mencapai', 'Baik', 'Sangat Baik'];

/**
 * Kktp_defaultIntervalsFor_(kktp)
 * [0,kktp-1] [kktp,kktp+9] [kktp+10,kktp+19] [kktp+20,100] — pola persis
 * di semua contoh spec user (kktp=70 → 0-69/70-79/80-89/90-100; kktp=75 →
 * 0-74/75-84/85-94/95-100).
 */
function Kktp_defaultIntervalsFor_(kktp) {
  return {
    interval_1_min: 0, interval_1_max: kktp - 1, interval_1_label: KKTP_INTERVAL_LABELS_DEFAULT_[0],
    interval_2_min: kktp, interval_2_max: kktp + 9, interval_2_label: KKTP_INTERVAL_LABELS_DEFAULT_[1],
    interval_3_min: kktp + 10, interval_3_max: kktp + 19, interval_3_label: KKTP_INTERVAL_LABELS_DEFAULT_[2],
    interval_4_min: kktp + 20, interval_4_max: 100, interval_4_label: KKTP_INTERVAL_LABELS_DEFAULT_[3]
  };
}

// SATU tempat 15 angka default KKTP ditulis (dipakai untuk seed
// MASTER_KKTP DAN fallback terakhir di kode kalau sheet/baris belum ada
// sama sekali — supaya guru tidak pernah terblokir menunggu Superadmin
// menyentuh fitur ini sebelum bisa melihat kategori Nilai Akhir).
const KKTP_DEFAULT_TABLE_ = [
  { jenjang: 'SD', tingkat: '1', nilai_kktp: 70 }, { jenjang: 'SD', tingkat: '2', nilai_kktp: 70 }, { jenjang: 'SD', tingkat: '3', nilai_kktp: 70 },
  { jenjang: 'SD', tingkat: '4', nilai_kktp: 75 }, { jenjang: 'SD', tingkat: '5', nilai_kktp: 75 }, { jenjang: 'SD', tingkat: '6', nilai_kktp: 75 },
  { jenjang: 'SMP', tingkat: '7', nilai_kktp: 75 }, { jenjang: 'SMP', tingkat: '8', nilai_kktp: 75 }, { jenjang: 'SMP', tingkat: '9', nilai_kktp: 75 },
  { jenjang: 'SMA', tingkat: '10', nilai_kktp: 75 }, { jenjang: 'SMA', tingkat: '11', nilai_kktp: 75 }, { jenjang: 'SMA', tingkat: '12', nilai_kktp: 75 },
  { jenjang: 'SMK', tingkat: '10', nilai_kktp: 75 }, { jenjang: 'SMK', tingkat: '11', nilai_kktp: 75 }, { jenjang: 'SMK', tingkat: '12', nilai_kktp: 75 }
].map(function (row) { return Object.assign({}, row, Kktp_defaultIntervalsFor_(row.nilai_kktp)); });

/**
 * Kktp_validateIntervals_(k)
 * interval_1_min harus 0, interval_4_max harus 100, tiap interval
 * berikutnya harus mulai persis 1 di atas maksimum sebelumnya (tidak ada
 * celah, tidak ada tumpang tindih) — sesuai contoh valid/invalid di spec.
 */
function Kktp_validateIntervals_(k) {
  const mins = [1, 2, 3, 4].map(function (i) { return Number(k['interval_' + i + '_min']); });
  const maxs = [1, 2, 3, 4].map(function (i) { return Number(k['interval_' + i + '_max']); });
  if (mins.concat(maxs).some(function (v) { return isNaN(v) || v < 0 || v > 100; })) {
    throw new Error('Batas interval harus angka 0–100.');
  }
  if (mins[0] !== 0) throw new Error('Batas bawah interval pertama harus 0.');
  if (maxs[3] !== 100) throw new Error('Batas atas interval terakhir harus 100.');
  for (let i = 0; i < 4; i++) {
    if (mins[i] > maxs[i]) throw new Error('Interval ke-' + (i + 1) + ': minimum tidak boleh lebih besar dari maksimum.');
  }
  for (let i = 0; i < 3; i++) {
    if (mins[i + 1] !== maxs[i] + 1) {
      throw new Error('Interval tidak boleh ada celah/tumpang tindih — interval ke-' + (i + 2) + ' harus mulai dari ' + (maxs[i] + 1) + '.');
    }
  }
}

/**
 * Kktp_categorize_(nilai, kktpConfig)
 * Nilai Akhir bisa desimal (83.60) — kategori DICARI dengan threshold
 * menaik (interval dengan `min` TERBESAR yang <= nilai), bukan
 * `min<=x<=max` per interval, supaya tidak ada celah rawan di batas
 * pecahan. `max` tetap tersimpan untuk tampilan/validasi, bukan dasar
 * pencarian. Status ketercapaian dibandingkan langsung ke nilai_kktp,
 * terpisah dari kategori.
 */
function Kktp_categorize_(nilai, kktpConfig) {
  if (nilai === '' || nilai === null || nilai === undefined || isNaN(nilai)) {
    return { nilai_kktp: '', kategori: '', status_ketercapaian: '' };
  }
  const n = Number(nilai);
  const intervals = [1, 2, 3, 4].map(function (i) {
    return { min: Number(kktpConfig['interval_' + i + '_min']), label: kktpConfig['interval_' + i + '_label'] };
  }).sort(function (a, b) { return a.min - b.min; });

  let kategori = intervals[0].label;
  intervals.forEach(function (iv) { if (n >= iv.min) kategori = iv.label; });

  return {
    nilai_kktp: Number(kktpConfig.nilai_kktp),
    kategori: kategori,
    status_ketercapaian: n >= Number(kktpConfig.nilai_kktp) ? 'TERCAPAI' : 'BELUM_TERCAPAI'
  };
}

/**
 * Nilai_getKktpConfig_(sekolahId, tahunAjaranId, semester, jenjang, tingkat, mapelId)
 * Dipanggil GURU (lewat saveMyGradeSheetBatch, SEKALI per batch — bukan
 * per siswa, lihat catatan performance di blueprint) maupun Superadmin.
 * Cuma getSheetByName langsung (BUKAN Config_getSheet_/Config_ensureCentralSheet_)
 * supaya tidak pernah mencoba insertSheet dari konteks guru — kalau sheet
 * belum ada sama sekali, langsung jatuh ke fallback kode di bawah.
 */
function Nilai_getKktpConfig_(sekolahId, tahunAjaranId, semester, jenjang, tingkat, mapelId) {
  const ss = Config_getCentralSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG_KKTP_SHEET_);
  const rows = sh ? Utils_sheetToObjects_(sh).filter(function (r) {
    return r.jenjang === jenjang && String(r.tingkat) === String(tingkat) && String(r.status).toUpperCase() !== 'NONAKTIF';
  }) : [];

  const match = Utils_pickMostSpecificScopedRow_(rows, { sekolahId: sekolahId, tahunAjaranId: tahunAjaranId, semester: semester, mapelId: mapelId });
  if (match) return match;

  const def = KKTP_DEFAULT_TABLE_.filter(function (d) { return d.jenjang === jenjang && String(d.tingkat) === String(tingkat); })[0];
  return def || Object.assign({ nilai_kktp: 75 }, Kktp_defaultIntervalsFor_(75));
}

/**
 * Kktp_ensureSeeded_(sh)
 * Tambahkan 15 baris default (sekolah_id/tahun_ajaran_id/semester/mapel_id
 * kosong = berlaku sistem-lebar) yang BELUM ada — idempoten, aman
 * dipanggil berulang setiap kali panel KKTP Superadmin dibuka.
 */
function Kktp_ensureSeeded_(sh) {
  const existing = Utils_sheetToObjects_(sh);
  const existingDefaults = {};
  existing.forEach(function (r) {
    if (!r.sekolah_id && !r.tahun_ajaran_id && !r.semester && !r.mapel_id) existingDefaults[r.jenjang + '|' + r.tingkat] = true;
  });
  const now = new Date();
  let seeded = 0;
  KKTP_DEFAULT_TABLE_.forEach(function (d) {
    const key = d.jenjang + '|' + d.tingkat;
    if (existingDefaults[key]) return;
    Utils_appendRowByHeader_(sh, Object.assign({
      kktp_id: Utils_newId_('KKTP'), sekolah_id: '', tahun_ajaran_id: '', semester: '', mapel_id: '',
      status: 'AKTIF', created_at: now, updated_at: now
    }, d));
    seeded++;
  });
  return seeded;
}

function adminSeedDefaultKktp() {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KKTP_SHEET_, CONFIG_KKTP_HEADERS_);
  return { seeded: Kktp_ensureSeeded_(sh) };
}

function adminGetKktpList(filters) {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KKTP_SHEET_, CONFIG_KKTP_HEADERS_);
  Kktp_ensureSeeded_(sh);

  let rows = Utils_sheetToObjects_(sh).map(function (r) { delete r._row; return r; });
  filters = filters || {};
  if (filters.sekolah_id) rows = rows.filter(function (r) { return !r.sekolah_id || r.sekolah_id === filters.sekolah_id; });
  if (filters.tahun_ajaran_id) rows = rows.filter(function (r) { return !r.tahun_ajaran_id || r.tahun_ajaran_id === filters.tahun_ajaran_id; });
  if (filters.jenjang) rows = rows.filter(function (r) { return r.jenjang === filters.jenjang; });
  if (filters.tingkat) rows = rows.filter(function (r) { return String(r.tingkat) === String(filters.tingkat); });
  if (filters.mapel_id) rows = rows.filter(function (r) { return !r.mapel_id || r.mapel_id === filters.mapel_id; });
  return rows;
}

function adminSaveKktp(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  data = data || {};
  if (!data.jenjang || !data.tingkat) throw new Error('Jenjang dan tingkat wajib diisi.');
  const kktp = Number(data.nilai_kktp);
  if (isNaN(kktp) || kktp < 0 || kktp > 100) throw new Error('Nilai KKTP harus angka 0–100.');
  Kktp_validateIntervals_(data);

  const sh = Config_ensureCentralSheet_(CONFIG_KKTP_SHEET_, CONFIG_KKTP_HEADERS_);
  const patch = {
    sekolah_id: data.sekolah_id || '', tahun_ajaran_id: data.tahun_ajaran_id || '', semester: data.semester || '',
    jenjang: data.jenjang, tingkat: String(data.tingkat), mapel_id: data.mapel_id || '', nilai_kktp: kktp,
    updated_at: new Date()
  };
  [1, 2, 3, 4].forEach(function (i) {
    patch['interval_' + i + '_min'] = Number(data['interval_' + i + '_min']);
    patch['interval_' + i + '_max'] = Number(data['interval_' + i + '_max']);
    patch['interval_' + i + '_label'] = data['interval_' + i + '_label'] || KKTP_INTERVAL_LABELS_DEFAULT_[i - 1];
  });

  if (data.kktp_id) {
    const rowNum = Utils_findRowById_(sh, 'kktp_id', data.kktp_id);
    if (rowNum === -1) throw new Error('Data KKTP tidak ditemukan.');
    Utils_updateRowByHeader_(sh, rowNum, patch);
    AuditLog_write_(auth, 'UPDATE_KKTP', 'KKTP', data.kktp_id, JSON.stringify(patch));
    return { kktp_id: data.kktp_id };
  }

  const kktpId = Utils_newId_('KKTP');
  Utils_appendRowByHeader_(sh, Object.assign({ kktp_id: kktpId, status: 'AKTIF', created_at: new Date() }, patch));
  AuditLog_write_(auth, 'CREATE_KKTP', 'KKTP', kktpId, JSON.stringify(patch));
  return { kktp_id: kktpId };
}

function adminToggleKktpStatus(kktpId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KKTP_SHEET_, CONFIG_KKTP_HEADERS_);
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.kktp_id === kktpId; })[0];
  if (!row) throw new Error('Data KKTP tidak ditemukan.');
  const newStatus = String(row.status).toUpperCase() === 'AKTIF' ? 'NONAKTIF' : 'AKTIF';
  Utils_updateRowByHeader_(sh, row._row, { status: newStatus, updated_at: new Date() });
  AuditLog_write_(auth, 'TOGGLE_KKTP_STATUS', 'KKTP', kktpId, newStatus);
  return { status: newStatus };
}

/**
 * adminPreviewCopyKktp(sourceKktpId, targets) / adminExecuteCopyKktp(...)
 * targets: [{tingkat, tahun_ajaran_id?}] — preview TANPA menulis apa pun,
 * konfirmasi baru benar-benar insert (pola sama seperti preview/execute
 * Kenaikan Kelas yang sudah ada).
 */
function adminPreviewCopyKktp(sourceKktpId, targets) {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KKTP_SHEET_, CONFIG_KKTP_HEADERS_);
  const source = Utils_sheetToObjects_(sh).filter(function (r) { return r.kktp_id === sourceKktpId; })[0];
  if (!source) throw new Error('KKTP sumber tidak ditemukan.');

  return (targets || []).map(function (t) {
    const copy = Object.assign({}, source);
    delete copy._row;
    copy.tingkat = t.tingkat || source.tingkat;
    if (t.tahun_ajaran_id !== undefined && t.tahun_ajaran_id !== '') copy.tahun_ajaran_id = t.tahun_ajaran_id;
    return copy;
  });
}

function adminExecuteCopyKktp(sourceKktpId, targets) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_ensureCentralSheet_(CONFIG_KKTP_SHEET_, CONFIG_KKTP_HEADERS_);
  const source = Utils_sheetToObjects_(sh).filter(function (r) { return r.kktp_id === sourceKktpId; })[0];
  if (!source) throw new Error('KKTP sumber tidak ditemukan.');
  if (!targets || !targets.length) throw new Error('Pilih minimal satu tujuan salin.');

  const now = new Date();
  let created = 0;
  targets.forEach(function (t) {
    const row = Object.assign({}, source);
    delete row._row;
    row.kktp_id = Utils_newId_('KKTP');
    row.tingkat = t.tingkat || source.tingkat;
    if (t.tahun_ajaran_id !== undefined && t.tahun_ajaran_id !== '') row.tahun_ajaran_id = t.tahun_ajaran_id;
    row.status = 'AKTIF';
    row.created_at = now;
    row.updated_at = now;
    Utils_appendRowByHeader_(sh, row);
    created++;
  });

  AuditLog_write_(auth, 'COPY_KKTP', 'KKTP', sourceKktpId, created + ' salinan dibuat');
  return { created: created };
}
