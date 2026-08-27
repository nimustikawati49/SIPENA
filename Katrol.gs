// Katrol.gs — Katrol Nilai Akhir. Menyusul nilai_akhir_murni (NILAI_AKHIR,
// dihitung otomatis di Nilai.gs) → pemetaan linear opsional ke rentang
// target yang ditentukan guru, dipakai untuk keperluan administrasi
// nilai/rapor/Dapodik. nilai_akhir_murni TIDAK PERNAH ditimpa — katrol
// hanya mengisi kolom nilai_akhir_katrol yang sudah ada, dan HANYA lewat
// aksi eksplisit guru (preview wajib sebelum simpan), bukan otomatis di
// setiap simpan nilai seperti versi awal modul Nilai Akhir.
//
// Target katrol sepenuhnya kebijakan GURU sendiri, bukan Superadmin —
// KATROL_DEFAULT_TABLE_ di bawah cuma mengisi form awal panel katrol guru
// per jenjang+tingkat (guru tetap harus lihat & konfirmasi angka aktual
// sebelum simpan, lihat getMyKatrolPreview/saveMyKatrol). Superadmin tidak
// punya panel konfigurasi untuk ini sama sekali.

const KATROL_PEMBULATAN_DEFAULT_ = 'BILANGAN_BULAT';

// SATU tempat angka default target katrol ditulis — dipakai sebagai nilai
// pengisi awal form panel katrol guru per jenjang+tingkat.
const KATROL_DEFAULT_TABLE_ = [
  { jenjang: 'SD', tingkat: '1', target_min: 70, target_max: 90 }, { jenjang: 'SD', tingkat: '2', target_min: 70, target_max: 90 }, { jenjang: 'SD', tingkat: '3', target_min: 70, target_max: 90 },
  { jenjang: 'SD', tingkat: '4', target_min: 75, target_max: 90 }, { jenjang: 'SD', tingkat: '5', target_min: 75, target_max: 90 }, { jenjang: 'SD', tingkat: '6', target_min: 75, target_max: 90 },
  { jenjang: 'SMP', tingkat: '7', target_min: 75, target_max: 90 }, { jenjang: 'SMP', tingkat: '8', target_min: 75, target_max: 90 }, { jenjang: 'SMP', tingkat: '9', target_min: 75, target_max: 90 },
  { jenjang: 'SMA', tingkat: '10', target_min: 75, target_max: 90 }, { jenjang: 'SMA', tingkat: '11', target_min: 75, target_max: 90 }, { jenjang: 'SMA', tingkat: '12', target_min: 75, target_max: 90 },
  { jenjang: 'SMK', tingkat: '10', target_min: 75, target_max: 90 }, { jenjang: 'SMK', tingkat: '11', target_min: 75, target_max: 90 }, { jenjang: 'SMK', tingkat: '12', target_min: 75, target_max: 90 }
].map(function (row) { return Object.assign({}, row, { pembulatan: KATROL_PEMBULATAN_DEFAULT_ }); });

/**
 * Katrol_ensureHistorySheet_(ss)
 * Sama pola Nilai_ensureNilaiAkhirSheet_ — Config_ensureGuruSheet_ aman
 * dipanggil setiap saat (cuma ensure kolom kalau sheet sudah ada, insertSheet
 * kalau belum), try/catch cuma untuk jalur insertSheet yang bisa ditolak
 * izin Drive untuk akun guru.
 */
function Katrol_ensureHistorySheet_(ss) {
  try {
    return Config_ensureGuruSheet_(ss, 'KATROL_HISTORY');
  } catch (e) {
    throw new Error('Modul Katrol Nilai belum siap untuk akun Anda. Minta Superadmin menjalankan migrasi sheet operasional guru.');
  }
}

/**
 * Nilai_getKatrolTargetConfig_(jenjang, tingkat)
 * Default target katrol murni dari kode (KATROL_DEFAULT_TABLE_) — tidak
 * ada lagi config Superadmin yang bisa mengubah ini, cuma titik awal
 * pengisian form yang tetap 100% bisa diubah guru sebelum simpan.
 */
function Nilai_getKatrolTargetConfig_(jenjang, tingkat) {
  const def = KATROL_DEFAULT_TABLE_.filter(function (d) { return d.jenjang === jenjang && String(d.tingkat) === String(tingkat); })[0];
  return def || { target_min: 75, target_max: 90, pembulatan: KATROL_PEMBULATAN_DEFAULT_ };
}

/**
 * Katrol_linearScale_(value, sourceMin, sourceMax, targetMin, targetMax)
 * Rumus persis spec: target_min + (value-source_min)/(source_max-source_min) * (target_max-target_min),
 * di-clamp [0,100] jaga-jaga floating point. Pemanggil wajib pastikan
 * sourceMin !== sourceMax dulu (kasus itu ditangani terpisah, lihat §27).
 */
function Katrol_linearScale_(value, sourceMin, sourceMax, targetMin, targetMax) {
  const raw = targetMin + ((value - sourceMin) / (sourceMax - sourceMin)) * (targetMax - targetMin);
  return Math.max(0, Math.min(100, raw));
}

function Katrol_round_(value, pembulatan) {
  if (pembulatan === '1_DESIMAL') return Math.round(value * 10) / 10;
  if (pembulatan === '2_DESIMAL') return Math.round(value * 100) / 100;
  return Math.round(value);
}

function Katrol_validateTarget_(targetMin, targetMax) {
  targetMin = Number(targetMin); targetMax = Number(targetMax);
  if (isNaN(targetMin) || isNaN(targetMax) || targetMin < 0 || targetMax > 100) {
    throw new Error('Target katrol harus angka 0–100.');
  }
  if (targetMin >= targetMax) throw new Error('Target minimum harus lebih kecil dari target maksimum.');
  return { targetMin: targetMin, targetMax: targetMax };
}

/**
 * Katrol_computeScope_(ss, kelasId, mapelId, tahunAjaranId, semester)
 * Baca NILAI_AKHIR sekali, kembalikan siswa yang punya nilai_akhir_murni
 * ANGKA saja (kosong dikecualikan total dari source_min/max maupun hasil
 * katrol — tetap Belum Lengkap) plus source_min/max otomatis.
 */
function Katrol_computeScope_(ss, kelasId, mapelId, tahunAjaranId, semester) {
  Nilai_ensureNilaiAkhirSheet_(ss);
  const students = Utils_sheetToObjects_(ss.getSheetByName('SISWA')).filter(function (r) {
    return r.kelas_id === kelasId && String(r.status).toUpperCase() !== 'NONAKTIF';
  });
  const akhirBySiswa = {};
  Utils_sheetToObjects_(ss.getSheetByName('NILAI_AKHIR')).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester;
  }).forEach(function (r) { akhirBySiswa[r.siswa_id] = r; });

  const withMurni = [];
  students.forEach(function (s) {
    const akhir = akhirBySiswa[s.siswa_id];
    if (!akhir || akhir.nilai_akhir_murni === '' || akhir.nilai_akhir_murni === null || isNaN(akhir.nilai_akhir_murni)) return;
    withMurni.push({ siswa_id: s.siswa_id, nis: s.nis, nama_lengkap: s.nama_lengkap, nilai_akhir_murni: Number(akhir.nilai_akhir_murni) });
  });

  if (!withMurni.length) throw new Error('Belum ada Nilai Akhir yang lengkap untuk kelas/mapel/periode ini — isi dan simpan nilai dulu di tab Input Nilai.');

  const nums = withMurni.map(function (s) { return s.nilai_akhir_murni; });
  return { students: withMurni, sourceMin: Math.min.apply(null, nums), sourceMax: Math.max.apply(null, nums) };
}

/**
 * getMyKatrolTargetDefault(kelasId, mapelId, tahunAjaranId, semester)
 * Nilai AWAL untuk mengisi form panel "Katrol Nilai" guru (lihat catatan
 * §2.3 blueprint) — bukan dipakai untuk validasi/simpan, cuma kemudahan
 * UI supaya guru tidak mulai dari kosong.
 */
function getMyKatrolTargetDefault(kelasId, mapelId, tahunAjaranId, semester) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);
  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const kelasInfo = Utils_sheetToObjects_(ss.getSheetByName('KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  if (!kelasInfo) return { target_min: 75, target_max: 90, pembulatan: KATROL_PEMBULATAN_DEFAULT_ };
  return Nilai_getKatrolTargetConfig_(kelasInfo.jenjang, kelasInfo.tingkat);
}

/**
 * getMyKatrolPreview(kelasId, mapelId, tahunAjaranId, semester, targetMin, targetMax, uniformValue)
 * Tidak menulis apa pun — preview murni. uniformValue HANYA dipakai kalau
 * source_min===source_max DAN guru eksplisit memilih opsi "gunakan nilai
 * target tertentu" (spec §27) — kalau tidak diisi, respons uniform:true
 * tanpa hasil katrol (guru harus pilih salah satu opsi dulu).
 */
function getMyKatrolPreview(kelasId, mapelId, tahunAjaranId, semester, targetMin, targetMax, uniformValue) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);
  const target = Katrol_validateTarget_(targetMin, targetMax);

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const scope = Katrol_computeScope_(ss, kelasId, mapelId, tahunAjaranId, semester);

  const kelasInfo = Utils_sheetToObjects_(ss.getSheetByName('KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  const pembulatan = kelasInfo
    ? Nilai_getKatrolTargetConfig_(kelasInfo.jenjang, kelasInfo.tingkat).pembulatan || KATROL_PEMBULATAN_DEFAULT_
    : KATROL_PEMBULATAN_DEFAULT_;

  if (scope.sourceMin === scope.sourceMax) {
    if (uniformValue === undefined || uniformValue === null || uniformValue === '') {
      return {
        uniform: true, source_min: scope.sourceMin, source_max: scope.sourceMax, jumlah_siswa: scope.students.length,
        message: 'Seluruh nilai murni memiliki nilai yang sama. Katrol proporsional tidak dapat dilakukan.'
      };
    }
    const uv = Number(uniformValue);
    if (isNaN(uv) || uv < 0 || uv > 100) throw new Error('Nilai target harus angka 0–100.');
    return {
      uniform: true, source_min: scope.sourceMin, source_max: scope.sourceMax, target_min: target.targetMin, target_max: target.targetMax,
      jumlah_siswa: scope.students.length,
      students: scope.students.map(function (s) { return Object.assign({}, s, { nilai_akhir_katrol_preview: Katrol_round_(uv, pembulatan) }); })
    };
  }

  return {
    uniform: false, source_min: scope.sourceMin, source_max: scope.sourceMax, target_min: target.targetMin, target_max: target.targetMax,
    jumlah_siswa: scope.students.length,
    students: scope.students.map(function (s) {
      const katrol = Katrol_round_(Katrol_linearScale_(s.nilai_akhir_murni, scope.sourceMin, scope.sourceMax, target.targetMin, target.targetMax), pembulatan);
      return Object.assign({}, s, { nilai_akhir_katrol_preview: katrol });
    })
  };
}

/**
 * saveMyKatrol(kelasId, mapelId, tahunAjaranId, semester, targetMin, targetMax, uniformValue)
 * Hitung ULANG dari nol (tidak percaya preview klien — backend sumber
 * kebenaran, pola sama seperti saveMyGradeSheetBatch), tulis
 * nilai_akhir_katrol batch (satu setValues), catat SATU baris
 * KATROL_HISTORY (bukan per siswa).
 */
function saveMyKatrol(kelasId, mapelId, tahunAjaranId, semester, targetMin, targetMax, uniformValue) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);
  const target = Katrol_validateTarget_(targetMin, targetMax);

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const scope = Katrol_computeScope_(ss, kelasId, mapelId, tahunAjaranId, semester);

  const kelasInfo = Utils_sheetToObjects_(ss.getSheetByName('KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  const pembulatan = kelasInfo
    ? Nilai_getKatrolTargetConfig_(kelasInfo.jenjang, kelasInfo.tingkat).pembulatan || KATROL_PEMBULATAN_DEFAULT_
    : KATROL_PEMBULATAN_DEFAULT_;

  let katrolBySiswa;
  if (scope.sourceMin === scope.sourceMax) {
    const uv = Number(uniformValue);
    if (isNaN(uv) || uv < 0 || uv > 100) {
      throw new Error('Seluruh nilai murni memiliki nilai yang sama — pilih "Gunakan nilai target tertentu" dan isi angkanya dulu, atau batalkan katrol.');
    }
    katrolBySiswa = {};
    scope.students.forEach(function (s) { katrolBySiswa[s.siswa_id] = Katrol_round_(uv, pembulatan); });
  } else {
    katrolBySiswa = {};
    scope.students.forEach(function (s) {
      katrolBySiswa[s.siswa_id] = Katrol_round_(Katrol_linearScale_(s.nilai_akhir_murni, scope.sourceMin, scope.sourceMax, target.targetMin, target.targetMax), pembulatan);
    });
  }

  const akhirSh = ss.getSheetByName('NILAI_AKHIR');
  const akhirHeader = akhirSh.getRange(1, 1, 1, akhirSh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const akhirIdx = Utils_headerIndex_(akhirHeader);
  const akhirData = akhirSh.getLastRow() > 1 ? akhirSh.getRange(2, 1, akhirSh.getLastRow() - 1, akhirHeader.length).getValues() : [];

  akhirData.forEach(function (row) {
    if (row[akhirIdx.kelas_id] === kelasId && row[akhirIdx.mapel_id] === mapelId && row[akhirIdx.tahun_ajaran_id] === tahunAjaranId && row[akhirIdx.semester] === semester) {
      const siswaId = row[akhirIdx.siswa_id];
      if (katrolBySiswa.hasOwnProperty(siswaId)) {
        row[akhirIdx.nilai_akhir_katrol] = katrolBySiswa[siswaId];
        row[akhirIdx.updated_at] = new Date();
      }
    }
  });

  if (akhirData.length) {
    akhirSh.getRange(2, 1, akhirData.length, akhirHeader.length).setValues(akhirData);
  }

  const historySh = Katrol_ensureHistorySheet_(ss);
  Utils_appendRowByHeader_(historySh, {
    katrol_id: Utils_newId_('KTR'), guru_id: auth.guruId, sekolah_id: auth.sekolahId, mapel_id: mapelId, kelas_id: kelasId,
    tahun_ajaran_id: tahunAjaranId, semester: semester, source_min: scope.sourceMin, source_max: scope.sourceMax,
    target_min: target.targetMin, target_max: target.targetMax, jumlah_siswa: scope.students.length,
    created_by: auth.email, created_at: new Date()
  });

  Dashboard_invalidateCache_(auth.guruId);
  AuditLog_write_(auth, 'SAVE_KATROL', 'Nilai', kelasId + '/' + mapelId, scope.students.length + ' siswa, target ' + target.targetMin + '-' + target.targetMax);
  return { ok: true, jumlah_siswa: scope.students.length };
}

/**
 * resetMyKatrol(kelasId, mapelId, tahunAjaranId, semester)
 * nilai_akhir_katrol kembali kosong untuk seluruh scope — nilai_akhir_murni
 * TIDAK disentuh. Tidak menambah baris KATROL_HISTORY (histori itu jejak
 * "bagaimana angka katrol didapat", reset justru menghapusnya) — dicatat
 * cukup di AUDIT_LOG umum.
 */
function resetMyKatrol(kelasId, mapelId, tahunAjaranId, semester) {
  const auth = Security_requireRole_(['GURU']);
  Nilai_validateScope_(kelasId, mapelId, tahunAjaranId, semester);

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  Nilai_ensureNilaiAkhirSheet_(ss);
  const akhirSh = ss.getSheetByName('NILAI_AKHIR');
  const akhirHeader = akhirSh.getRange(1, 1, 1, akhirSh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const akhirIdx = Utils_headerIndex_(akhirHeader);
  const akhirData = akhirSh.getLastRow() > 1 ? akhirSh.getRange(2, 1, akhirSh.getLastRow() - 1, akhirHeader.length).getValues() : [];

  let reset = 0;
  akhirData.forEach(function (row) {
    if (row[akhirIdx.kelas_id] === kelasId && row[akhirIdx.mapel_id] === mapelId && row[akhirIdx.tahun_ajaran_id] === tahunAjaranId && row[akhirIdx.semester] === semester && row[akhirIdx.nilai_akhir_katrol] !== '') {
      row[akhirIdx.nilai_akhir_katrol] = '';
      row[akhirIdx.updated_at] = new Date();
      reset++;
    }
  });

  if (reset && akhirData.length) {
    akhirSh.getRange(2, 1, akhirData.length, akhirHeader.length).setValues(akhirData);
  }

  Dashboard_invalidateCache_(auth.guruId);
  AuditLog_write_(auth, 'RESET_KATROL', 'Nilai', kelasId + '/' + mapelId, reset + ' siswa direset');
  return { ok: true, reset: reset };
}

