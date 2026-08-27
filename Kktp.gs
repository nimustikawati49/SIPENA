// Kktp.gs — KKTP (Kriteria Ketercapaian Tujuan Pembelajaran). Kebijakan
// milik GURU sendiri (bukan Superadmin) — guru mengisi satu angka Nilai
// KKTP per kelas/mapel/periode lewat form pengaturan miliknya sendiri
// (lihat saveMyGradeSettings/Nilai_getSettings_ di Nilai.gs), disimpan di
// sheet PENGATURAN pribadinya. 4 kategori (Belum Mencapai/Mencapai/Baik/
// Sangat Baik) SELALU dihitung otomatis dari angka itu — tidak ada lagi
// konfigurasi interval terpisah, supaya guru tidak perlu paham konsep
// interval sama sekali. Kalau guru belum pernah mengisi, dipakai default
// bawaan sistem per jenjang+tingkat (KKTP_DEFAULT_TABLE_).

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

// SATU tempat 15 angka default KKTP ditulis — dipakai sebagai nilai
// pengisi awal form pengaturan guru DAN fallback terakhir kalau guru
// belum pernah mengisi nilai KKTP-nya sendiri sama sekali.
const KKTP_DEFAULT_TABLE_ = [
  { jenjang: 'SD', tingkat: '1', nilai_kktp: 70 }, { jenjang: 'SD', tingkat: '2', nilai_kktp: 70 }, { jenjang: 'SD', tingkat: '3', nilai_kktp: 70 },
  { jenjang: 'SD', tingkat: '4', nilai_kktp: 75 }, { jenjang: 'SD', tingkat: '5', nilai_kktp: 75 }, { jenjang: 'SD', tingkat: '6', nilai_kktp: 75 },
  { jenjang: 'SMP', tingkat: '7', nilai_kktp: 75 }, { jenjang: 'SMP', tingkat: '8', nilai_kktp: 75 }, { jenjang: 'SMP', tingkat: '9', nilai_kktp: 75 },
  { jenjang: 'SMA', tingkat: '10', nilai_kktp: 75 }, { jenjang: 'SMA', tingkat: '11', nilai_kktp: 75 }, { jenjang: 'SMA', tingkat: '12', nilai_kktp: 75 },
  { jenjang: 'SMK', tingkat: '10', nilai_kktp: 75 }, { jenjang: 'SMK', tingkat: '11', nilai_kktp: 75 }, { jenjang: 'SMK', tingkat: '12', nilai_kktp: 75 }
];

function Kktp_defaultValueFor_(jenjang, tingkat) {
  const def = KKTP_DEFAULT_TABLE_.filter(function (d) { return d.jenjang === jenjang && String(d.tingkat) === String(tingkat); })[0];
  return def ? def.nilai_kktp : 75;
}

/**
 * Kktp_categorize_(nilai, kktpConfig)
 * Nilai Akhir bisa desimal (83.60) — kategori DICARI dengan threshold
 * menaik (interval dengan `min` TERBESAR yang <= nilai), bukan
 * `min<=x<=max` per interval, supaya tidak ada celah rawan di batas
 * pecahan. Status ketercapaian dibandingkan langsung ke nilai_kktp,
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
 * Nilai_getKktpConfig_(nilaiKktpGuru, jenjang, tingkat)
 * nilaiKktpGuru: angka yang guru isi sendiri di PENGATURAN (lewat
 * Nilai_getSettings_) — kosong/'' berarti guru belum pernah mengisi,
 * jatuh ke default sistem per jenjang+tingkat. Kategori (4 pita) SELALU
 * dihitung ulang dari angka ini, tidak pernah tersimpan terpisah.
 */
function Nilai_getKktpConfig_(nilaiKktpGuru, jenjang, tingkat) {
  const nilai = (nilaiKktpGuru !== '' && nilaiKktpGuru !== null && nilaiKktpGuru !== undefined && !isNaN(nilaiKktpGuru))
    ? Number(nilaiKktpGuru)
    : Kktp_defaultValueFor_(jenjang, tingkat);
  return Object.assign({ nilai_kktp: nilai }, Kktp_defaultIntervalsFor_(nilai));
}
