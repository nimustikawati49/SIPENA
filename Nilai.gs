// Nilai.gs — Phase 4. GURU only, selalu beroperasi di spreadsheet PRIBADI
// guru (Config_getGuruSpreadsheet_(auth.guruId) — tidak pernah menerima
// spreadsheet/guru_id dari client). Model row-per-jenis_nilai (bukan
// kolom tetap seperti SAG) supaya fleksibel menambah jenis nilai baru
// tanpa migrasi skema, dan siap menampung nilai pindahan (Phase 6) tanpa
// perubahan struktur.
//
// nilai_katrol = rescale linear min-max nilai_murni SEKELAS (kelas+mapel+
// tahun_ajaran+semester+jenis_nilai) ke [nilai_min_target, nilai_max_target]
// dari PENGATURAN — baris sumber_nilai=SEKOLAH_ASAL (nilai pindahan)
// SENGAJA dikecualikan dari perhitungan ini (bukan bagian sebaran kelas
// saat ini), sesuai blueprint §8. Cetak/export nilai adalah Phase 7,
// belum ada di sini.

const NILAI_JENIS_VALID_ = ['TUGAS', 'UH', 'PTS', 'SAS', 'ASAT', 'RAPOR_TERAKHIR', 'LAINNYA'];
const NILAI_DEFAULT_KKM_ = 75;
const NILAI_DEFAULT_MIN_TARGET_ = 70;
const NILAI_DEFAULT_MAX_TARGET_ = 100;

function Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester, jenisNilai) {
  if (!kelasId || !mapelId || !tahunAjaranId) throw new Error('Kelas, mapel, dan tahun ajaran wajib diisi.');
  if (['GANJIL', 'GENAP'].indexOf(semester) === -1) throw new Error('Semester harus GANJIL atau GENAP.');
  if (jenisNilai !== undefined && NILAI_JENIS_VALID_.indexOf(jenisNilai) === -1) throw new Error('Jenis nilai tidak valid.');
}

/**
 * getMyGradeSheet(kelasId, mapelId, tahunAjaranId, semester, jenisNilai)
 * Satu panggilan: daftar siswa di kelas ini (dari roster SISWA yang
 * sudah tersinkron) DIGABUNG dengan nilai yang sudah ada untuk
 * kombinasi ini, plus pengaturan KKM/rentang katrol — siap dirender
 * sebagai tabel input tanpa panggilan tambahan.
 */
function getMyGradeSheet(kelasId, mapelId, tahunAjaranId, semester, jenisNilai) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester, jenisNilai);

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const students = Utils_sheetToObjects_(ss.getSheetByName('SISWA')).filter(function (r) {
    return r.kelas_id === kelasId && String(r.status).toUpperCase() !== 'NONAKTIF';
  });

  const nilaiBySiswa = {};
  Utils_sheetToObjects_(ss.getSheetByName('NILAI')).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId &&
      r.semester === semester && r.jenis_nilai === jenisNilai;
  }).forEach(function (r) { nilaiBySiswa[r.siswa_id] = r; });

  const rows = students.map(function (s) {
    const n = nilaiBySiswa[s.siswa_id];
    return {
      siswa_id: s.siswa_id, nis: s.nis, nama_lengkap: s.nama_lengkap,
      nilai_id: n ? n.nilai_id : '',
      nilai_murni: n ? n.nilai_murni : '',
      nilai_katrol: n ? n.nilai_katrol : '',
      sumber_nilai: n ? n.sumber_nilai : 'SEKOLAH_SAAT_INI'
    };
  });

  return { students: rows, settings: Nilai_getSettings_(ss, kelasId, mapelId, tahunAjaranId, semester) };
}

function Nilai_getSettings_(ss, kelasId, mapelId, tahunAjaranId, semester) {
  const row = Utils_sheetToObjects_(ss.getSheetByName('PENGATURAN')).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
  })[0];
  return {
    kkm: row && row.kkm !== '' ? Number(row.kkm) : NILAI_DEFAULT_KKM_,
    nilai_min_target: row && row.nilai_min_target !== '' ? Number(row.nilai_min_target) : NILAI_DEFAULT_MIN_TARGET_,
    nilai_max_target: row && row.nilai_max_target !== '' ? Number(row.nilai_max_target) : NILAI_DEFAULT_MAX_TARGET_
  };
}

function saveMyGradeSettings(kelasId, mapelId, tahunAjaranId, semester, kkm, nilaiMinTarget, nilaiMaxTarget) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);
  kkm = Number(kkm); nilaiMinTarget = Number(nilaiMinTarget); nilaiMaxTarget = Number(nilaiMaxTarget);
  if ([kkm, nilaiMinTarget, nilaiMaxTarget].some(function (v) { return isNaN(v) || v < 0 || v > 100; })) {
    throw new Error('KKM dan rentang katrol harus angka 0–100.');
  }
  if (nilaiMinTarget >= nilaiMaxTarget) throw new Error('Nilai minimum target harus lebih kecil dari maksimum.');

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const sh = ss.getSheetByName('PENGATURAN');
  const existing = Utils_sheetToObjects_(sh).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
  })[0];

  const patch = { kkm: kkm, nilai_min_target: nilaiMinTarget, nilai_max_target: nilaiMaxTarget };
  if (existing) {
    Utils_updateRowByHeader_(sh, existing._row, patch);
  } else {
    Utils_appendRowByHeader_(sh, Object.assign({ kelas_id: kelasId, mapel_id: mapelId, tahun_ajaran_id: tahunAjaranId, semester: semester }, patch));
  }
  return { ok: true };
}

/**
 * saveMyGrades(kelasId, mapelId, tahunAjaranId, semester, jenisNilai, entries)
 * entries: [{siswa_id, nilai_murni}]. Baris tanpa nilai_murni diisi
 * (kosong/undefined) DILEWATI — kosong TIDAK PERNAH diperlakukan sebagai
 * 0 (mandat blueprint §10, berlaku umum bukan cuma pindahan). Baca
 * sekali, ubah di memori, tulis sekali (satu setValues untuk seluruh
 * sheet NILAI) — bukan satu writeCall per siswa.
 */
function saveMyGrades(kelasId, mapelId, tahunAjaranId, semester, jenisNilai, entries) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester, jenisNilai);
  if (jenisNilai === 'RAPOR_TERAKHIR') throw new Error('Jenis nilai ini khusus siswa pindahan, diisi lewat modul Mutasi (belum tersedia).');

  const cleanEntries = (entries || []).filter(function (e) {
    return e && e.siswa_id && e.nilai_murni !== '' && e.nilai_murni !== null && e.nilai_murni !== undefined;
  });
  cleanEntries.forEach(function (e) {
    const v = Number(e.nilai_murni);
    if (isNaN(v) || v < 0 || v > 100) throw new Error('Nilai tidak valid untuk salah satu siswa (harus 0–100): "' + e.nilai_murni + '".');
  });
  if (!cleanEntries.length) throw new Error('Tidak ada nilai yang diisi.');

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const sh = ss.getSheetByName('NILAI');
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const idx = Utils_headerIndex_(header);
  const dataRange = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, header.length).getValues() : [];

  const byKey = {};
  dataRange.forEach(function (row, i) {
    if (row[idx.kelas_id] === kelasId && row[idx.mapel_id] === mapelId && row[idx.tahun_ajaran_id] === tahunAjaranId &&
      row[idx.semester] === semester && row[idx.jenis_nilai] === jenisNilai) {
      byKey[row[idx.siswa_id]] = i;
    }
  });

  const now = new Date();
  const riwayatHeader = ss.getSheetByName('RIWAYAT_NILAI').getRange(1, 1, 1, ss.getSheetByName('RIWAYAT_NILAI').getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').toLowerCase().trim(); });
  const rIdx = Utils_headerIndex_(riwayatHeader);
  const riwayatRows = [];

  cleanEntries.forEach(function (e) {
    const newVal = Number(e.nilai_murni);
    if (byKey.hasOwnProperty(e.siswa_id)) {
      const i = byKey[e.siswa_id];
      const oldVal = dataRange[i][idx.nilai_murni];
      if (String(oldVal) !== String(newVal)) {
        const rRow = riwayatHeader.map(function () { return ''; });
        rRow[rIdx.riwayat_id] = Utils_newId_('RN');
        rRow[rIdx.nilai_id] = dataRange[i][idx.nilai_id];
        rRow[rIdx.nilai_sebelum] = oldVal;
        rRow[rIdx.nilai_sesudah] = newVal;
        rRow[rIdx.updated_by] = auth.email;
        rRow[rIdx.updated_at] = now;
        riwayatRows.push(rRow);
      }
      dataRange[i][idx.nilai_murni] = newVal;
      dataRange[i][idx.tanggal_input] = now;
    } else {
      const newRow = header.map(function () { return ''; });
      newRow[idx.nilai_id] = Utils_newId_('NL');
      newRow[idx.siswa_id] = e.siswa_id;
      newRow[idx.guru_id] = auth.guruId;
      newRow[idx.mapel_id] = mapelId;
      newRow[idx.kelas_id] = kelasId;
      newRow[idx.sekolah_id] = auth.sekolahId;
      newRow[idx.tahun_ajaran_id] = tahunAjaranId;
      newRow[idx.semester] = semester;
      newRow[idx.jenis_nilai] = jenisNilai;
      newRow[idx.sumber_nilai] = 'SEKOLAH_SAAT_INI';
      newRow[idx.nilai_murni] = newVal;
      newRow[idx.tanggal_input] = now;
      dataRange.push(newRow);
      byKey[e.siswa_id] = dataRange.length - 1;
    }
  });

  const scopeIdxs = [];
  dataRange.forEach(function (row, i) {
    if (row[idx.kelas_id] === kelasId && row[idx.mapel_id] === mapelId && row[idx.tahun_ajaran_id] === tahunAjaranId &&
      row[idx.semester] === semester && row[idx.jenis_nilai] === jenisNilai && row[idx.sumber_nilai] !== 'SEKOLAH_ASAL') {
      scopeIdxs.push(i);
    }
  });
  Nilai_applyKatrol_(dataRange, idx, scopeIdxs, Nilai_getSettings_(ss, kelasId, mapelId, tahunAjaranId, semester));

  if (dataRange.length) {
    if (sh.getMaxRows() < dataRange.length + 1) sh.insertRowsAfter(sh.getMaxRows(), dataRange.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, dataRange.length, header.length).setValues(dataRange);
  }
  if (riwayatRows.length) {
    const riwayatSh = ss.getSheetByName('RIWAYAT_NILAI');
    const startRow = riwayatSh.getLastRow() + 1;
    riwayatSh.getRange(startRow, 1, riwayatRows.length, riwayatHeader.length).setValues(riwayatRows);
  }

  AuditLog_write_(auth, 'SAVE_GRADES', 'Nilai', kelasId + '/' + mapelId, cleanEntries.length + ' siswa, jenis=' + jenisNilai);
  return { ok: true, saved: cleanEntries.length };
}

/**
 * Nilai_applyKatrol_(dataRange, idx, scopeIdxs, settings)
 * Rescale linear min-max nilai_murni dalam scopeIdxs ke [min_target,
 * max_target]. Kalau semua nilai di scope itu sama (tidak ada variasi
 * untuk direntangkan), katrol = murni apa adanya — bukan otomatis
 * dibulatkan ke maksimum (menghindari kesan "menaikkan nilai" tanpa
 * dasar perbandingan).
 */
function Nilai_applyKatrol_(dataRange, idx, scopeIdxs, settings) {
  const nums = scopeIdxs.map(function (i) { return Number(dataRange[i][idx.nilai_murni]); }).filter(function (v) { return !isNaN(v); });
  if (!nums.length) return;
  const min = Math.min.apply(null, nums);
  const max = Math.max.apply(null, nums);

  scopeIdxs.forEach(function (i) {
    const v = Number(dataRange[i][idx.nilai_murni]);
    if (isNaN(v)) return;
    const katrol = (max === min) ? v : settings.nilai_min_target + ((v - min) / (max - min)) * (settings.nilai_max_target - settings.nilai_min_target);
    dataRange[i][idx.nilai_katrol] = Math.round(katrol * 100) / 100;
  });
}

/**
 * exportMyGradeRecapUrl(kelasId, mapelId, tahunAjaranId, semester)
 * Bangun ulang rekap di server (sama seperti getMyGradeRecap) dan tulis
 * ke sheet helper _EXPORT_REKAP di spreadsheet PRIBADI guru sendiri,
 * lalu kembalikan URL export-xlsx-nya (lihat Utils_writeExportSheetAndGetUrl_
 * untuk alasan kenapa server-side, bukan client-side Blob download).
 */
function exportMyGradeRecapUrl(kelasId, mapelId, tahunAjaranId, semester) {
  const auth = Security_requireRole_(['GURU']);
  const recap = getMyGradeRecap(kelasId, mapelId, tahunAjaranId, semester);

  const jenisSet = {};
  recap.forEach(function (r) { r.nilai.forEach(function (n) { jenisSet[n.jenis_nilai] = true; }); });
  const jenisList = Object.keys(jenisSet);
  if (!jenisList.length) throw new Error('Belum ada nilai yang diinput untuk kelas/mapel/periode ini.');

  const dataRows = recap.map(function (r) {
    const byJenis = {};
    r.nilai.forEach(function (n) { byJenis[n.jenis_nilai] = n; });
    const row = [r.nis || '-', r.nama_lengkap];
    jenisList.forEach(function (j) {
      const n = byJenis[j];
      row.push(n ? (n.nilai_murni + (n.nilai_katrol !== '' ? ' / ' + n.nilai_katrol : '')) : '-');
    });
    return row;
  });

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const url = Utils_writeExportSheetAndGetUrl_(ss, '_EXPORT_REKAP', ['NIS', 'Nama'].concat(jenisList), dataRows);
  return { export_url: url };
}

function getMyGradeHistory(nilaiId) {
  const auth = Security_requireRole_(['GURU']);
  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  return Utils_sheetToObjects_(ss.getSheetByName('RIWAYAT_NILAI'))
    .filter(function (r) { return r.nilai_id === nilaiId; })
    .map(function (r) { delete r._row; return r; })
    .sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
}

/**
 * getMyGradeRecap(kelasId, mapelId, tahunAjaranId, semester)
 * Semua jenis_nilai untuk satu kelas+mapel+periode, per siswa — dasar
 * tabel rekap (kolom jenis_nilai dibentuk dinamis di frontend).
 */
function getMyGradeRecap(kelasId, mapelId, tahunAjaranId, semester) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const students = Utils_sheetToObjects_(ss.getSheetByName('SISWA')).filter(function (r) {
    return r.kelas_id === kelasId && String(r.status).toUpperCase() !== 'NONAKTIF';
  });

  const bySiswa = {};
  Utils_sheetToObjects_(ss.getSheetByName('NILAI')).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
  }).forEach(function (r) {
    if (!bySiswa[r.siswa_id]) bySiswa[r.siswa_id] = [];
    bySiswa[r.siswa_id].push({ jenis_nilai: r.jenis_nilai, nilai_murni: r.nilai_murni, nilai_katrol: r.nilai_katrol, sumber_nilai: r.sumber_nilai });
  });

  return students.map(function (s) {
    return { siswa_id: s.siswa_id, nis: s.nis, nama_lengkap: s.nama_lengkap, nilai: bySiswa[s.siswa_id] || [] };
  });
}
