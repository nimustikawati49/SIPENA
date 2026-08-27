// Dashboard.gs — dashboard & profil guru (Phase 3). Pola "satu panggilan
// agregat" (getMyDashboard) sejak awal, bukan disusun dari N panggilan
// terpisah — pelajaran performa terpenting dari SAG (DASH_ALL).

/**
 * getMyDashboard()
 * GURU only. Baca PROFIL/MAPEL/KELAS/PENUGASAN dari spreadsheet PRIBADI
 * guru (resolve via auth.guruId, bukan parameter client) satu kali,
 * cache 300s dengan key yang menyertakan guru_id (CacheService.getScriptCache
 * — BUKAN getUserCache — supaya bisa di-invalidate dari eksekusi lain,
 * mis. Sync_teacherData_ yang berjalan sebagai Superadmin saat penugasan
 * guru berubah, bukan hanya dari sesi guru itu sendiri).
 */
function getMyDashboard() {
  const auth = Security_requireRole_(['GURU']);

  const cache = CacheService.getScriptCache();
  const cacheKey = Dashboard_cacheKey_(auth.guruId);
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* cache korup, baca ulang */ }
  }

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const profilRows = Utils_sheetToObjects_(ss.getSheetByName('PROFIL'));
  const profil = profilRows[0] || {};
  delete profil._row;

  const mapel = Utils_sheetToObjects_(ss.getSheetByName('MAPEL')).map(Dashboard_stripRow_);
  const kelas = Utils_sheetToObjects_(ss.getSheetByName('KELAS')).map(Dashboard_stripRow_);
  const penugasan = Utils_sheetToObjects_(ss.getSheetByName('PENUGASAN')).map(Dashboard_stripRow_);
  const jumlahSiswa = Utils_sheetToObjects_(ss.getSheetByName('SISWA'))
    .filter(function (s) { return String(s.status).toUpperCase() !== 'NONAKTIF'; }).length;

  const sekolah = Utils_sheetToObjects_(Config_getSheet_('MASTER_SEKOLAH'))
    .filter(function (r) { return r.sekolah_id === profil.sekolah_id; })[0];

  const todayHari = Dashboard_todayHari_();
  const jadwalMinggu = Utils_sheetToObjects_(ss.getSheetByName('JADWAL'))
    .filter(function (r) { return String(r.status).toUpperCase() === 'AKTIF'; })
    .map(Dashboard_stripRow_)
    .sort(function (a, b) { return String(a.jam_mulai).localeCompare(String(b.jam_mulai)); });

  const result = {
    profil: profil,
    nama_sekolah: sekolah ? sekolah.nama_sekolah : '-',
    ringkasan: {
      jumlah_mapel: mapel.length,
      jumlah_kelas: kelas.length,
      jumlah_siswa: jumlahSiswa,
      jumlah_penugasan_aktif: penugasan.filter(function (p) { return String(p.status).toUpperCase() === 'AKTIF'; }).length
    },
    mapel: mapel,
    kelas: kelas,
    penugasan: penugasan,
    hari_ini: todayHari,
    jadwal_minggu: jadwalMinggu,
    nilai_completion: Dashboard_computeGradeCompletion_(ss)
  };

  try { cache.put(cacheKey, JSON.stringify(result), 300); } catch (e) { /* > 100KB, lewati cache */ }
  return result;
}

/**
 * updateMyProfile(data)
 * GURU only, dan HANYA field non-kritis (no_hp/foto_url/ttd_url) — nama,
 * NIP, sekolah, dsb. dikelola Superadmin (spec §11), tidak diterima di
 * sini walau dikirim client.
 *
 * SELURUH isi fungsi dibungkus try/catch — bukan cuma langkah tulis sel
 * terakhir seperti versi sebelumnya. Revisi ini menutup celah: versi
 * lama cuma membungkus Utils_updateRowByHeader_, padahal
 * Config_getGuruSpreadsheet_ (buka spreadsheet guru) di ATASNYA bisa
 * juga melempar exception permission mentah dan lolos tanpa tertangkap
 * sama sekali — persis skenario yang membuat pesan "Anda tidak memiliki
 * izin..." masih muncul apa adanya walau langkah tulisnya sudah
 * dilindungi. Sama pola dengan saveMyGradeSettings (Nilai.gs).
 */
function updateMyProfile(data) {
  const auth = Security_requireRole_(['GURU']);
  const patch = {};
  ['no_hp', 'foto_url', 'ttd_url'].forEach(function (k) {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  patch.updated_at = new Date();

  try {
    const ss = Config_getGuruSpreadsheet_(auth.guruId);
    const sh = ss.getSheetByName('PROFIL');
    if (!sh || sh.getLastRow() < 2) throw new Error('Profil belum tersedia. Hubungi Superadmin.');
    Utils_updateRowByHeader_(sh, 2, patch);
  } catch (e) {
    throw new Error('Gagal menyimpan — akun Anda tampaknya tidak punya akses ke spreadsheet pribadi Anda. Minta Superadmin memprovisi ulang spreadsheet Anda (menu Guru → Provisi ulang).');
  }

  Dashboard_invalidateCache_(auth.guruId);
  AuditLog_write_(auth, 'UPDATE_PROFILE', 'Profil', auth.guruId, JSON.stringify(patch));
  return { ok: true };
}

/**
 * uploadMyPhoto(base64Data, mimeType, fileName) / uploadMySignature(...)
 * Sama seperti updateMyProfile — HANYA field non-kritis (foto/tanda
 * tangan), disimpan ke Drive guru sendiri (Utils_saveUploadedFile_) lalu
 * URL-nya ditulis ke PROFIL. Dipisah dari updateMyProfile supaya upload
 * foto langsung tersimpan begitu dipilih, tanpa perlu klik "Simpan"
 * terpisah untuk field lain.
 */
function uploadMyPhoto(base64Data, mimeType, fileName) {
  const auth = Security_requireRole_(['GURU']);
  const url = Utils_saveUploadedFile_('SIPENA_Foto_Profil', base64Data, mimeType, fileName);
  Dashboard_patchProfilField_(auth, 'foto_url', url);
  return { url: url };
}

function uploadMySignature(base64Data, mimeType, fileName) {
  const auth = Security_requireRole_(['GURU']);
  const url = Utils_saveUploadedFile_('SIPENA_Tanda_Tangan', base64Data, mimeType, fileName);
  Dashboard_patchProfilField_(auth, 'ttd_url', url);
  return { url: url };
}

/**
 * Dashboard_patchProfilField_(auth, field, value)
 * Sama seperti updateMyProfile — SELURUH isi (termasuk buka spreadsheet
 * guru, bukan cuma langkah tulis) dibungkus try/catch, lihat catatan di
 * updateMyProfile soal celah versi sebelumnya.
 */
function Dashboard_patchProfilField_(auth, field, value) {
  const patch = {}; patch[field] = value; patch.updated_at = new Date();
  try {
    const ss = Config_getGuruSpreadsheet_(auth.guruId);
    const sh = ss.getSheetByName('PROFIL');
    if (!sh || sh.getLastRow() < 2) throw new Error('Profil belum tersedia. Hubungi Superadmin.');
    Utils_updateRowByHeader_(sh, 2, patch);
  } catch (e) {
    throw new Error('File berhasil diunggah ke Drive, tapi gagal disimpan ke profil — akun Anda tampaknya tidak punya akses ke spreadsheet pribadi Anda. Minta Superadmin memprovisi ulang spreadsheet Anda (menu Guru → Provisi ulang).');
  }
  Dashboard_invalidateCache_(auth.guruId);
  AuditLog_write_(auth, 'UPDATE_PROFILE', 'Profil', auth.guruId, field + '=' + value);
}

function Dashboard_cacheKey_(guruId) {
  return 'DASH_ALL_' + guruId;
}

function Dashboard_invalidateCache_(guruId) {
  try { CacheService.getScriptCache().remove(Dashboard_cacheKey_(guruId)); } catch (e) {}
}

function Dashboard_stripRow_(obj) {
  const copy = Object.assign({}, obj);
  delete copy._row;
  return copy;
}

/**
 * Dashboard_todayHari_()
 * "SENIN".."SABTU"/"MINGGU" berdasarkan timezone SCRIPT (Asia/Makassar),
 * bukan format locale bawaan (Utilities.formatDate 'EEEE' tidak bisa
 * dipastikan bahasa Indonesia) — dihitung dari nomor hari ISO (1=Senin..
 * 7=Minggu) supaya hasilnya selalu konsisten.
 */
function Dashboard_todayHari_() {
  const names = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
  const isoDay = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'u'));
  return names[isoDay % 7];
}

/**
 * Dashboard_computeGradeCompletion_(ss)
 * Untuk tiap (kelas+mapel+tahun_ajaran+semester) yang SUDAH mulai diisi
 * nilainya: kumpulkan jenis_nilai yang pernah diinput di scope itu
 * ("jenis yang diharapkan" — bukan diasumsikan dari luar, murni dari
 * apa yang guru sendiri sudah mulai kerjakan), lalu untuk tiap siswa di
 * kelas itu cek apakah SEMUA jenis itu sudah terisi. Siswa yang belum
 * lengkap disertakan dengan daftar jenis_nilai spesifik yang masih
 * kosong — dasar tampilan ringkasan + detail di dashboard guru.
 */
function Dashboard_computeGradeCompletion_(ss) {
  const siswaByKelas = {};
  Utils_sheetToObjects_(ss.getSheetByName('SISWA')).forEach(function (s) {
    if (String(s.status).toUpperCase() === 'NONAKTIF') return;
    if (!siswaByKelas[s.kelas_id]) siswaByKelas[s.kelas_id] = [];
    siswaByKelas[s.kelas_id].push(s);
  });

  const scopes = {};
  Utils_sheetToObjects_(ss.getSheetByName('NILAI')).forEach(function (r) {
    const scopeKey = [r.kelas_id, r.mapel_id, r.tahun_ajaran_id, r.semester].join('|');
    if (!scopes[scopeKey]) {
      scopes[scopeKey] = { kelas_id: r.kelas_id, mapel_id: r.mapel_id, jenisSet: {}, bySiswa: {} };
    }
    const sc = scopes[scopeKey];
    sc.jenisSet[r.jenis_nilai] = true;
    if (r.nilai_murni !== '' && r.nilai_murni !== undefined && r.nilai_murni !== null) {
      if (!sc.bySiswa[r.siswa_id]) sc.bySiswa[r.siswa_id] = {};
      sc.bySiswa[r.siswa_id][r.jenis_nilai] = true;
    }
  });

  const mapelNameById = {};
  Utils_sheetToObjects_(ss.getSheetByName('MAPEL')).forEach(function (m) { mapelNameById[m.mapel_id] = m.nama_mapel; });
  const kelasNameById = {};
  Utils_sheetToObjects_(ss.getSheetByName('KELAS')).forEach(function (k) { kelasNameById[k.kelas_id] = k.nama_kelas; });

  return Object.keys(scopes).map(function (scopeKey) {
    const sc = scopes[scopeKey];
    const jenisList = Object.keys(sc.jenisSet);
    const siswaKelas = siswaByKelas[sc.kelas_id] || [];

    let lengkap = 0;
    const siswaBelum = [];
    siswaKelas.forEach(function (s) {
      const done = sc.bySiswa[s.siswa_id] || {};
      const jenisBelum = jenisList.filter(function (j) { return !done[j]; });
      if (jenisBelum.length === 0) { lengkap++; } else { siswaBelum.push({ siswa_id: s.siswa_id, nama_lengkap: s.nama_lengkap, jenis_belum: jenisBelum }); }
    });

    return {
      kelas_id: sc.kelas_id, nama_kelas: kelasNameById[sc.kelas_id] || sc.kelas_id,
      mapel_id: sc.mapel_id, nama_mapel: mapelNameById[sc.mapel_id] || sc.mapel_id,
      jenis_nilai_list: jenisList, total_siswa: siswaKelas.length, siswa_lengkap: lengkap,
      persentase: siswaKelas.length ? Math.round((lengkap / siswaKelas.length) * 100) : 0,
      siswa_belum: siswaBelum
    };
  }).filter(function (r) { return r.total_siswa > 0 && r.jenis_nilai_list.length > 0; })
    .sort(function (a, b) { return a.persentase - b.persentase; });
}
