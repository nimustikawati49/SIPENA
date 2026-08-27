// Print.gs — Cetak Daftar Nilai. Satu fungsi (getMyPrintData) yang
// menggabungkan data yang SUDAH dihitung modul Nilai (lewat
// getMyGradeSheetWide, TIDAK menghitung ulang dengan cara berbeda) dengan
// info sekolah (kop, dari MASTER_SEKOLAH via auth.sekolahId — TIDAK PERNAH
// dari parameter klien) dan profil guru sendiri (tanda tangan). Template
// visual (kop/judul/tabel/tanda tangan) dibangun di klien
// (scripts-nilai.html: PrintApp_*) dari data mentah ini — satu panggilan
// dipakai untuk preview MAUPUN cetak, tidak pernah baca ulang Sheet.

/**
 * getMyPrintData(kelasId, mapelId, tahunAjaranId, semester)
 * GURU only. Mengembalikan semua yang dibutuhkan template cetak: sekolah
 * (kop), guru (identitas+tanda tangan), mapel/kelas/tahun ajaran (label),
 * dan siswa+nilai (dari getMyGradeSheetWide, dilengkapi jenis_kelamin
 * yang belum ada di respons itu).
 */
function getMyPrintData(kelasId, mapelId, tahunAjaranId, semester) {
  const auth = Security_requireRole_(['GURU']);
  const grades = getMyGradeSheetWide(kelasId, mapelId, tahunAjaranId, semester);

  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const profil = Utils_sheetToObjects_(ss.getSheetByName('PROFIL'))[0] || {};
  const mapelRow = Utils_sheetToObjects_(ss.getSheetByName('MAPEL')).filter(function (r) { return r.mapel_id === mapelId; })[0];
  const kelasRow = Utils_sheetToObjects_(ss.getSheetByName('KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];

  const siswaDetailById = {};
  Utils_sheetToObjects_(ss.getSheetByName('SISWA')).forEach(function (r) { siswaDetailById[r.siswa_id] = r; });

  const pindahanBySiswa = {};
  Utils_sheetToObjects_(ss.getSheetByName('NILAI')).filter(function (r) {
    return r.kelas_id === kelasId && r.mapel_id === mapelId && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester &&
      r.jenis_nilai === 'RAPOR_TERAKHIR' && r.sumber_nilai === 'SEKOLAH_ASAL';
  }).forEach(function (r) { pindahanBySiswa[r.siswa_id] = r.nilai_murni; });

  grades.students.forEach(function (s) {
    const detail = siswaDetailById[s.siswa_id];
    s.jenis_kelamin = detail ? detail.jenis_kelamin : '';
    s.nilai_pindahan = pindahanBySiswa.hasOwnProperty(s.siswa_id) ? pindahanBySiswa[s.siswa_id] : '';
  });

  const sekolahRow = Utils_sheetToObjects_(Config_getSheet_('MASTER_SEKOLAH')).filter(function (r) { return r.sekolah_id === auth.sekolahId; })[0] || {};
  const tahunAjaranRow = Utils_sheetToObjects_(Config_getSheet_('MASTER_TAHUN_AJARAN')).filter(function (r) { return r.tahun_ajaran_id === tahunAjaranId; })[0];

  return {
    sekolah: {
      nama_sekolah: sekolahRow.nama_sekolah || '', kabupaten: sekolahRow.kabupaten || '',
      kecamatan: sekolahRow.kecamatan || '', tempat_cetak: sekolahRow.tempat_cetak || ''
    },
    guru: {
      nama_lengkap: profil.nama_lengkap || auth.namaLengkap || '', nip: profil.nip || '', nuptk: profil.nuptk || '',
      jabatan: profil.jabatan || '', ttd_url: profil.ttd_url || ''
    },
    mapel: { nama_mapel: mapelRow ? mapelRow.nama_mapel : '' },
    kelas: { nama_kelas: kelasRow ? kelasRow.nama_kelas : '' },
    tahun_ajaran: { label: tahunAjaranRow ? tahunAjaranRow.label : '' },
    semester: semester,
    assessment_label: grades.assessmentLabel,
    students: grades.students
  };
}

/**
 * getMySekolahKopOptions()
 * GURU only — daftar kop AKTIF milik sekolah guru sendiri (auth.sekolahId,
 * tidak pernah dari parameter klien), dipakai mengisi dropdown "Pilih Kop"
 * di panel Cetak. Dipanggil sekali saat tab Cetak dibuka, terpisah dari
 * getMyPrintData supaya guru bisa lihat pilihan kop sebelum menentukan
 * penugasan/kolom (dan tidak perlu fetch ulang tiap ganti pilihan cetak).
 */
function getMySekolahKopOptions() {
  const auth = Security_requireRole_(['GURU']);
  const ss = Config_getCentralSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG_KOP_SHEET_);
  if (!sh) return [];
  return Utils_sheetToObjects_(sh).filter(function (r) {
    return r.sekolah_id === auth.sekolahId && String(r.status).toUpperCase() === 'AKTIF';
  }).map(function (r) { return { kop_id: r.kop_id, nama_kop: r.nama_kop, paper_hint: r.paper_hint, image_url: r.image_url }; });
}
