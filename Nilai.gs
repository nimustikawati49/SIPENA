// Nilai.gs — GURU only, selalu beroperasi di spreadsheet PRIBADI guru
// (Config_getGuruSpreadsheet_(auth.guruId) — tidak pernah menerima
// spreadsheet/guru_id dari client). Model row-per-jenis_nilai (sheet
// NILAI, satu baris per komponen) dipertahankan dari awal proyek supaya
// menambah jenis nilai baru tidak perlu migrasi skema — modul Nilai Akhir
// di bawah ini PIVOT baris-baris itu jadi tabel lebar di memori, bukan
// mengubah skema jadi kolom tetap.
//
// Dua lapis katrol: (a) per-komponen (Nilai_applyKatrol_, existing, tetap
// dipakai rekap per-jenis), (b) level Nilai Akhir (Nilai_applyFinalKatrol_,
// baru — rescale nilai_akhir_murni sekelas). Baris sumber_nilai=SEKOLAH_ASAL
// (nilai pindahan, jenis RAPOR_TERAKHIR) otomatis TIDAK ikut kedua lapis
// katrol maupun rata-rata harian/Nilai Akhir, karena RAPOR_TERAKHIR bukan
// bagian dari NILAI_HARIAN_JENIS_/PTS/ASAS-ASAT yang dipakai modul ini.

const NILAI_HARIAN_JENIS_ = ['TGS1', 'TGS2', 'TGS3', 'UH1', 'UH2', 'UH3'];
const NILAI_DEFAULT_KKM_ = 75;
const NILAI_DEFAULT_MIN_TARGET_ = 70;
const NILAI_DEFAULT_MAX_TARGET_ = 100;

const NILAI_MODE_VALID_ = ['WAJIB_LENGKAP', 'KOMPONEN_TERSEDIA'];
const NILAI_BOBOT_DEFAULT_ = { bobot_harian: 60, bobot_pts: 20, bobot_akhir_semester: 20, mode_perhitungan: 'WAJIB_LENGKAP', decimal_places: 2 };

function Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester) {
  if (!kelasId || !mapelId || !tahunAjaranId) throw new Error('Kelas, mapel, dan tahun ajaran wajib diisi.');
  if (['GANJIL', 'GENAP'].indexOf(semester) === -1) throw new Error('Semester harus GANJIL atau GENAP.');
}

/**
 * Nilai_getAssessmentLabel_(semester)
 * GANJIL → ASAS, GENAP → ASAT — satu fungsi sumber kebenaran dipakai
 * backend (sini) dan disalin identik di NilaiApp_assessmentLabel_
 * (scripts-nilai.html) untuk preview klien, supaya label kolom tabel
 * tidak pernah hardcode di dua tempat berbeda.
 */
function Nilai_getAssessmentLabel_(semester) {
  return semester === 'GENAP' ? 'ASAT' : 'ASAS';
}

/**
 * Nilai_ensureNilaiAkhirSheet_(ss)
 * Config_ensureGuruSheet_ SELALU dipanggil (bukan cuma kalau sheet belum
 * ada) supaya kolom baru yang ditambahkan ke skema NILAI_AKHIR di rilis
 * berikutnya (mis. nilai_kktp/kategori/status_ketercapaian) ikut
 * ditambahkan ke sheet guru yang SUDAH punya NILAI_AKHIR dari rilis
 * sebelumnya — itu operasi tulis SEL biasa (Config_ensureGuruSheetColumns_),
 * aman dari konteks guru. try/catch di sini murni untuk jalur
 * insertSheet (sheet yang BENAR-BENAR belum ada), yang bisa ditolak izin
 * Drive untuk akun guru — lempar pesan jelas alih-alih exception mentah.
 */
function Nilai_ensureNilaiAkhirSheet_(ss) {
  try {
    return Config_ensureGuruSheet_(ss, 'NILAI_AKHIR');
  } catch (e) {
    throw new Error('Modul Nilai Akhir belum siap untuk akun Anda. Minta Superadmin menjalankan migrasi sheet Nilai Akhir.');
  }
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
 * Nilai_getBobotConfig_(sekolahId)
 * Bobot & mode perhitungan Nilai Akhir adalah kebijakan sekolah, diatur
 * Superadmin (lihat adminGetBobotNilai/adminSaveBobotNilai di Sekolah.gs)
 * — fallback default kalau sekolah belum pernah mengatur (pola sama
 * seperti Nilai_getSettings_ di atas).
 */
function Nilai_getBobotConfig_(sekolahId) {
  const sh = Config_getSheet_(CONFIG_BOBOT_NILAI_SHEET_);
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.sekolah_id === sekolahId; })[0];
  if (!row) return Object.assign({}, NILAI_BOBOT_DEFAULT_);
  return {
    bobot_harian: row.bobot_harian !== '' ? Number(row.bobot_harian) : NILAI_BOBOT_DEFAULT_.bobot_harian,
    bobot_pts: row.bobot_pts !== '' ? Number(row.bobot_pts) : NILAI_BOBOT_DEFAULT_.bobot_pts,
    bobot_akhir_semester: row.bobot_akhir_semester !== '' ? Number(row.bobot_akhir_semester) : NILAI_BOBOT_DEFAULT_.bobot_akhir_semester,
    mode_perhitungan: NILAI_MODE_VALID_.indexOf(row.mode_perhitungan) !== -1 ? row.mode_perhitungan : NILAI_BOBOT_DEFAULT_.mode_perhitungan,
    decimal_places: row.decimal_places !== '' && !isNaN(row.decimal_places) ? Number(row.decimal_places) : NILAI_BOBOT_DEFAULT_.decimal_places
  };
}

/**
 * Nilai_calculateDailyAverage_(values)
 * Rata-rata dari nilai yang TERISI saja ('', null, undefined DIBUANG,
 * bukan dianggap 0). Semua kosong → '' (tampil "-"), bukan 0.
 */
function Nilai_calculateDailyAverage_(values) {
  const nums = (values || []).filter(function (v) { return v !== '' && v !== null && v !== undefined && !isNaN(v); }).map(Number);
  if (!nums.length) return '';
  return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
}

/**
 * Nilai_calculateFinalScore_(rataHarian, pts, akhirSemester, bobotConfig)
 * mode WAJIB_LENGKAP (default): ketiga komponen harus terisi, kalau tidak
 * → {nilai:'', status:'BELUM_LENGKAP'}.
 * mode KOMPONEN_TERSEDIA: weighted-average dari komponen yang tersedia,
 * bobot dinormalisasi ke jumlah bobot komponen yang ada.
 */
function Nilai_calculateFinalScore_(rataHarian, pts, akhirSemester, bobotConfig) {
  const comps = [
    { value: rataHarian, weight: bobotConfig.bobot_harian },
    { value: pts, weight: bobotConfig.bobot_pts },
    { value: akhirSemester, weight: bobotConfig.bobot_akhir_semester }
  ];
  const available = comps.filter(function (c) { return c.value !== '' && c.value !== null && c.value !== undefined && !isNaN(c.value); });

  if (bobotConfig.mode_perhitungan === 'KOMPONEN_TERSEDIA') {
    if (!available.length) return { nilai: '', status: 'BELUM_LENGKAP' };
    const totalWeight = available.reduce(function (s, c) { return s + c.weight; }, 0);
    const weighted = available.reduce(function (s, c) { return s + c.value * c.weight; }, 0);
    return {
      nilai: totalWeight ? weighted / totalWeight : '',
      status: available.length === comps.length ? 'LENGKAP' : 'BELUM_LENGKAP'
    };
  }

  if (available.length !== comps.length) return { nilai: '', status: 'BELUM_LENGKAP' };
  const nilai = comps.reduce(function (s, c) { return s + c.value * c.weight; }, 0) / 100;
  return { nilai: nilai, status: 'LENGKAP' };
}

/**
 * getMyGradeSheetWide(kelasId, mapelId, tahunAjaranId, semester)
 * Satu panggilan: roster siswa + semua komponen NILAI di scope ini
 * dipivot jadi satu baris lebar per siswa (TGS1..ASAS/ASAT), digabung
 * dengan ringkasan NILAI_AKHIR yang sudah tersimpan, plus settings KKM/
 * katrol, bobotConfig, dan assessmentLabel — siap dirender tanpa
 * panggilan tambahan (pola sama dengan getMyDashboard).
 */
function getMyGradeSheetWide(kelasId, mapelId, tahunAjaranId, semester) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  Nilai_ensureNilaiAkhirSheet_(ss);

  const students = Utils_sheetToObjects_(ss.getSheetByName('SISWA')).filter(function (r) {
    return r.kelas_id === kelasId && String(r.status).toUpperCase() !== 'NONAKTIF';
  });

  const assessmentLabel = Nilai_getAssessmentLabel_(semester);
  const wideJenis = NILAI_HARIAN_JENIS_.concat(['PTS', assessmentLabel]);

  const nilaiBySiswa = {};
  Utils_sheetToObjects_(ss.getSheetByName('NILAI')).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
  }).forEach(function (r) {
    if (!nilaiBySiswa[r.siswa_id]) nilaiBySiswa[r.siswa_id] = {};
    nilaiBySiswa[r.siswa_id][r.jenis_nilai] = r;
  });

  const akhirBySiswa = {};
  Utils_sheetToObjects_(ss.getSheetByName('NILAI_AKHIR')).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
  }).forEach(function (r) { akhirBySiswa[r.siswa_id] = r; });

  const rows = students.map(function (s) {
    const comps = nilaiBySiswa[s.siswa_id] || {};
    const wide = { siswa_id: s.siswa_id, nis: s.nis, nama_lengkap: s.nama_lengkap };
    wideJenis.forEach(function (j) {
      const c = comps[j];
      wide[j.toLowerCase()] = c && c.nilai_murni !== '' ? c.nilai_murni : '';
    });
    wide.dari_sekolah_asal = !!(comps.RAPOR_TERAKHIR && comps.RAPOR_TERAKHIR.sumber_nilai === 'SEKOLAH_ASAL');

    const akhir = akhirBySiswa[s.siswa_id];
    wide.rata_rata_harian = akhir && akhir.rata_rata_harian !== '' ? akhir.rata_rata_harian : '';
    wide.nilai_akhir_murni = akhir && akhir.nilai_akhir_murni !== '' ? akhir.nilai_akhir_murni : '';
    wide.nilai_akhir_katrol = akhir && akhir.nilai_akhir_katrol !== '' ? akhir.nilai_akhir_katrol : '';
    wide.status_nilai = akhir ? akhir.status_nilai : 'BELUM_LENGKAP';
    wide.nilai_kktp = akhir && akhir.nilai_kktp !== '' ? akhir.nilai_kktp : '';
    wide.kategori = akhir ? akhir.kategori : '';
    wide.status_ketercapaian = akhir ? akhir.status_ketercapaian : '';
    return wide;
  });

  return {
    students: rows,
    settings: Nilai_getSettings_(ss, kelasId, mapelId, tahunAjaranId, semester),
    bobotConfig: Nilai_getBobotConfig_(auth.sekolahId),
    assessmentLabel: assessmentLabel
  };
}

/**
 * saveMyGradeSheetBatch(kelasId, mapelId, tahunAjaranId, semester, rows)
 * rows: [{siswa_id, tgs1..uh3, pts, asas_atau_asat}] — HANYA siswa yang
 * benar-benar diubah guru di klien (dirty tracking), bukan seluruh
 * roster. Kosong TIDAK PERNAH ditulis sebagai 0 dan TIDAK PERNAH
 * menghapus nilai yang sudah tersimpan sebelumnya (kosong = "tidak
 * diubah", bukan "hapus"). Baca sekali/tulis sekali per sheet (NILAI,
 * RIWAYAT_NILAI, NILAI_AKHIR) — pola batch I/O yang dipakai di seluruh
 * SIPENA. Rata-rata/Nilai Akhir/status dihitung ulang HANYA untuk siswa
 * yang diubah; katrol (komponen & final) tetap rescale seluruh kelas
 * karena butuh sebaran kelas, tapi murni operasi memori (data sudah
 * terbaca), bukan panggilan Sheets API tambahan.
 */
function saveMyGradeSheetBatch(kelasId, mapelId, tahunAjaranId, semester, rows) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);

  const assessmentLabel = Nilai_getAssessmentLabel_(semester);
  const jenisKeys = NILAI_HARIAN_JENIS_.concat(['PTS', assessmentLabel]);

  const cleanRows = (rows || []).filter(function (r) { return r && r.siswa_id; });
  if (!cleanRows.length) throw new Error('Tidak ada nilai yang diubah.');

  cleanRows.forEach(function (r) {
    jenisKeys.forEach(function (j) {
      const v = r[j.toLowerCase()];
      if (v === '' || v === null || v === undefined) return;
      const n = Number(v);
      if (isNaN(n) || n < 0 || n > 100) throw new Error('Nilai harus antara 0–100 (siswa ' + r.siswa_id + ', ' + j + ': "' + v + '").');
    });
  });

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  Nilai_ensureNilaiAkhirSheet_(ss);

  const sh = ss.getSheetByName('NILAI');
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const idx = Utils_headerIndex_(header);
  const dataRange = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, header.length).getValues() : [];

  const byKey = {};
  dataRange.forEach(function (row, i) {
    if (row[idx.kelas_id] === kelasId && row[idx.mapel_id] === mapelId && row[idx.tahun_ajaran_id] === tahunAjaranId && row[idx.semester] === semester) {
      byKey[row[idx.siswa_id] + '|' + row[idx.jenis_nilai]] = i;
    }
  });

  const now = new Date();
  const riwayatSh = ss.getSheetByName('RIWAYAT_NILAI');
  const riwayatHeader = riwayatSh.getRange(1, 1, 1, riwayatSh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const rIdx = Utils_headerIndex_(riwayatHeader);
  const riwayatRows = [];
  const touchedSiswaIds = [];

  cleanRows.forEach(function (r) {
    touchedSiswaIds.push(r.siswa_id);
    jenisKeys.forEach(function (j) {
      const raw = r[j.toLowerCase()];
      const hasValue = !(raw === '' || raw === null || raw === undefined);
      const mapKey = r.siswa_id + '|' + j;

      if (byKey.hasOwnProperty(mapKey)) {
        if (!hasValue) return; // kosong = tidak diubah, jangan hapus data existing
        const i = byKey[mapKey];
        const newVal = Number(raw);
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
      } else if (hasValue) {
        const newVal = Number(raw);
        const newRow = header.map(function () { return ''; });
        newRow[idx.nilai_id] = Utils_newId_('NL');
        newRow[idx.siswa_id] = r.siswa_id;
        newRow[idx.guru_id] = auth.guruId;
        newRow[idx.mapel_id] = mapelId;
        newRow[idx.kelas_id] = kelasId;
        newRow[idx.sekolah_id] = auth.sekolahId;
        newRow[idx.tahun_ajaran_id] = tahunAjaranId;
        newRow[idx.semester] = semester;
        newRow[idx.jenis_nilai] = j;
        newRow[idx.sumber_nilai] = 'SEKOLAH_SAAT_INI';
        newRow[idx.nilai_murni] = newVal;
        newRow[idx.tanggal_input] = now;
        dataRange.push(newRow);
        byKey[mapKey] = dataRange.length - 1;
      }
    });
  });

  // Katrol per-komponen (existing behaviour) — seluruh scope kelas per jenis.
  const settings = Nilai_getSettings_(ss, kelasId, mapelId, tahunAjaranId, semester);
  jenisKeys.forEach(function (j) {
    const scopeIdxs = [];
    dataRange.forEach(function (row, i) {
      if (row[idx.kelas_id] === kelasId && row[idx.mapel_id] === mapelId && row[idx.tahun_ajaran_id] === tahunAjaranId &&
        row[idx.semester] === semester && row[idx.jenis_nilai] === j && row[idx.sumber_nilai] !== 'SEKOLAH_ASAL') {
        scopeIdxs.push(i);
      }
    });
    Nilai_applyKatrol_(dataRange, idx, scopeIdxs, settings);
  });

  if (dataRange.length) {
    if (sh.getMaxRows() < dataRange.length + 1) sh.insertRowsAfter(sh.getMaxRows(), dataRange.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, dataRange.length, header.length).setValues(dataRange);
  }
  if (riwayatRows.length) {
    const startRow = riwayatSh.getLastRow() + 1;
    riwayatSh.getRange(startRow, 1, riwayatRows.length, riwayatHeader.length).setValues(riwayatRows);
  }

  // --- Nilai Akhir: rata-rata/murni/status hanya utk siswa yang diubah ---
  function getMurni_(siswaId, jenis) {
    const i = byKey[siswaId + '|' + jenis];
    if (i === undefined) return '';
    const v = dataRange[i][idx.nilai_murni];
    return v === '' || v === null || v === undefined ? '' : Number(v);
  }

  const bobotConfig = Nilai_getBobotConfig_(auth.sekolahId);
  const kelasInfo = Utils_sheetToObjects_(ss.getSheetByName('KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  const kktpConfig = kelasInfo
    ? Nilai_getKktpConfig_(auth.sekolahId, tahunAjaranId, semester, kelasInfo.jenjang, kelasInfo.tingkat, mapelId)
    : null;
  const akhirSh = ss.getSheetByName('NILAI_AKHIR');
  const akhirHeader = akhirSh.getRange(1, 1, 1, akhirSh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const akhirIdx = Utils_headerIndex_(akhirHeader);
  const akhirData = akhirSh.getLastRow() > 1 ? akhirSh.getRange(2, 1, akhirSh.getLastRow() - 1, akhirHeader.length).getValues() : [];
  const akhirByKey = {};
  akhirData.forEach(function (row, i) {
    if (row[akhirIdx.kelas_id] === kelasId && row[akhirIdx.mapel_id] === mapelId && row[akhirIdx.tahun_ajaran_id] === tahunAjaranId && row[akhirIdx.semester] === semester) {
      akhirByKey[row[akhirIdx.siswa_id]] = i;
    }
  });

  const uniqueTouched = touchedSiswaIds.filter(function (id, i) { return touchedSiswaIds.indexOf(id) === i; });
  uniqueTouched.forEach(function (siswaId) {
    const harianVals = NILAI_HARIAN_JENIS_.map(function (j) { return getMurni_(siswaId, j); });
    const rataHarian = Nilai_calculateDailyAverage_(harianVals);
    const pts = getMurni_(siswaId, 'PTS');
    const akhirSem = getMurni_(siswaId, assessmentLabel);
    const finalResult = Nilai_calculateFinalScore_(rataHarian, pts, akhirSem, bobotConfig);

    let rowArr;
    const existingI = akhirByKey[siswaId];
    if (existingI !== undefined) {
      rowArr = akhirData[existingI];
    } else {
      rowArr = akhirHeader.map(function () { return ''; });
      rowArr[akhirIdx.nilai_akhir_id] = Utils_newId_('NA');
      rowArr[akhirIdx.siswa_id] = siswaId;
      rowArr[akhirIdx.guru_id] = auth.guruId;
      rowArr[akhirIdx.mapel_id] = mapelId;
      rowArr[akhirIdx.kelas_id] = kelasId;
      rowArr[akhirIdx.sekolah_id] = auth.sekolahId;
      rowArr[akhirIdx.tahun_ajaran_id] = tahunAjaranId;
      rowArr[akhirIdx.semester] = semester;
      akhirData.push(rowArr);
      akhirByKey[siswaId] = akhirData.length - 1;
    }
    rowArr[akhirIdx.rata_rata_harian] = rataHarian;
    rowArr[akhirIdx.nilai_akhir_murni] = finalResult.nilai;
    rowArr[akhirIdx.status_nilai] = finalResult.status;

    // Snapshot KKTP/kategori/status ketercapaian pada SAAT penilaian ini
    // disimpan — tidak berubah sendiri kalau Superadmin mengubah KKTP di
    // masa depan, hanya berubah kalau guru menyimpan ulang nilai siswa
    // ini (lihat catatan blueprint §1.5).
    const kategoriResult = kktpConfig ? Kktp_categorize_(finalResult.nilai, kktpConfig) : { nilai_kktp: '', kategori: '', status_ketercapaian: '' };
    rowArr[akhirIdx.nilai_kktp] = kategoriResult.nilai_kktp;
    rowArr[akhirIdx.kategori] = kategoriResult.kategori;
    rowArr[akhirIdx.status_ketercapaian] = kategoriResult.status_ketercapaian;
    rowArr[akhirIdx.updated_at] = now;
  });

  // Katrol Nilai Akhir — rescale nilai_akhir_murni SELURUH kelas (butuh
  // min-max sebaran kelas, tapi murni di memori, tidak ada baca tambahan).
  const finalScopeIdxs = [];
  akhirData.forEach(function (row, i) {
    if (row[akhirIdx.kelas_id] === kelasId && row[akhirIdx.mapel_id] === mapelId && row[akhirIdx.tahun_ajaran_id] === tahunAjaranId && row[akhirIdx.semester] === semester) {
      finalScopeIdxs.push(i);
    }
  });
  Nilai_applyFinalKatrol_(akhirData, akhirIdx, finalScopeIdxs, settings);

  if (akhirData.length) {
    if (akhirSh.getMaxRows() < akhirData.length + 1) akhirSh.insertRowsAfter(akhirSh.getMaxRows(), akhirData.length + 1 - akhirSh.getMaxRows());
    akhirSh.getRange(2, 1, akhirData.length, akhirHeader.length).setValues(akhirData);
  }

  Dashboard_invalidateCache_(auth.guruId);
  AuditLog_write_(auth, 'SAVE_GRADES', 'Nilai', kelasId + '/' + mapelId, uniqueTouched.length + ' siswa');
  return { ok: true, saved: uniqueTouched.length };
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
 * Nilai_applyFinalKatrol_(dataRange, idx, scopeIdxs, settings)
 * Sama seperti Nilai_applyKatrol_ tapi untuk nilai_akhir_murni →
 * nilai_akhir_katrol di sheet NILAI_AKHIR — baris dengan status
 * BELUM_LENGKAP (nilai_akhir_murni bukan angka) dilewati, katrolnya
 * dikosongkan (bukan ikut rescale sebagai 0).
 */
function Nilai_applyFinalKatrol_(dataRange, idx, scopeIdxs, settings) {
  const numericIdxs = scopeIdxs.filter(function (i) { return typeof dataRange[i][idx.nilai_akhir_murni] === 'number' && !isNaN(dataRange[i][idx.nilai_akhir_murni]); });
  scopeIdxs.forEach(function (i) {
    if (numericIdxs.indexOf(i) === -1) dataRange[i][idx.nilai_akhir_katrol] = '';
  });
  if (!numericIdxs.length) return;

  const nums = numericIdxs.map(function (i) { return dataRange[i][idx.nilai_akhir_murni]; });
  const min = Math.min.apply(null, nums);
  const max = Math.max.apply(null, nums);

  numericIdxs.forEach(function (i) {
    const v = dataRange[i][idx.nilai_akhir_murni];
    const katrol = (max === min) ? v : settings.nilai_min_target + ((v - min) / (max - min)) * (settings.nilai_max_target - settings.nilai_min_target);
    dataRange[i][idx.nilai_akhir_katrol] = Math.round(katrol * 100) / 100;
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
    row.push(r.rata_rata_harian !== '' ? r.rata_rata_harian : '-');
    row.push(r.nilai_akhir_murni !== '' ? (r.nilai_akhir_murni + (r.nilai_akhir_katrol !== '' ? ' / ' + r.nilai_akhir_katrol : '')) : '-');
    row.push(r.status_nilai === 'LENGKAP' ? 'Lengkap' : 'Belum Lengkap');
    row.push(r.nilai_kktp !== '' ? r.nilai_kktp : '-');
    row.push(r.kategori || '-');
    row.push(r.status_ketercapaian === 'TERCAPAI' ? 'Tercapai' : (r.status_ketercapaian === 'BELUM_TERCAPAI' ? 'Belum Tercapai' : '-'));
    return row;
  });

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const url = Utils_writeExportSheetAndGetUrl_(ss, '_EXPORT_REKAP', ['NIS', 'Nama'].concat(jenisList, ['Rata-rata Harian', 'Nilai Akhir', 'Status', 'KKTP', 'Kategori', 'Ketercapaian']), dataRows);
  return { export_url: url };
}

/**
 * getMyGradeRecap(kelasId, mapelId, tahunAjaranId, semester)
 * Semua komponen nilai untuk satu kelas+mapel+periode per siswa (kolom
 * jenis_nilai dibentuk dinamis di frontend), digabung dengan ringkasan
 * NILAI_AKHIR (rata-rata harian, Nilai Akhir murni/katrol, status).
 */
function getMyGradeRecap(kelasId, mapelId, tahunAjaranId, semester) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  Nilai_ensureNilaiAkhirSheet_(ss);
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

  const akhirBySiswa = {};
  Utils_sheetToObjects_(ss.getSheetByName('NILAI_AKHIR')).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
  }).forEach(function (r) { akhirBySiswa[r.siswa_id] = r; });

  return students.map(function (s) {
    const akhir = akhirBySiswa[s.siswa_id];
    return {
      siswa_id: s.siswa_id, nis: s.nis, nama_lengkap: s.nama_lengkap, nilai: bySiswa[s.siswa_id] || [],
      rata_rata_harian: akhir ? akhir.rata_rata_harian : '',
      nilai_akhir_murni: akhir ? akhir.nilai_akhir_murni : '',
      nilai_akhir_katrol: akhir ? akhir.nilai_akhir_katrol : '',
      status_nilai: akhir ? akhir.status_nilai : 'BELUM_LENGKAP',
      nilai_kktp: akhir ? akhir.nilai_kktp : '',
      kategori: akhir ? akhir.kategori : '',
      status_ketercapaian: akhir ? akhir.status_ketercapaian : ''
    };
  });
}
