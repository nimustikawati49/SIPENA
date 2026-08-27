// Jadwal.gs — jadwal mengajar adalah urusan operasional guru sendiri:
// guru mengelola jadwalnya langsung (tambah/ubah/hapus, tanpa approval)
// di sheet JADWAL milik spreadsheet PRIBADInya sendiri (bukan lagi sheet
// central JADWAL_MENGAJAR) — konsisten dengan perubahan arsitektur "database
// guru ada di akun masing-masing" (lihat catatan panjang di Guru.gs).
// Superadmin TIDAK lagi punya form tambah/ubah/hapus jadwal terpisah;
// tab Jadwal di sisi Superadmin sekarang cuma tampilan baca (per sekolah,
// atas permintaan, karena berarti membuka spreadsheet tiap guru satu per
// satu) untuk pemantauan — perbaikan langsung dilakukan dengan membuka
// spreadsheet guru itu sendiri (Superadmin sudah diberi akses Editor
// lewat Guru_grantSuperadminAccess_).
//
// Sheet central JADWAL_MENGAJAR (skema lama) SENGAJA dibiarkan ada di
// CONFIG_CENTRAL_SCHEMA_ dengan data historisnya — tidak dibaca/ditulis
// kode manapun di berkas ini lagi.

const JADWAL_HARI_VALID_ = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

function Jadwal_validateJam_(v) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(v || ''));
}

/**
 * Jadwal_normalizeJam_(v)
 * jam_mulai/jam_selesai HARUS tersimpan sebagai teks "HH:MM" — tapi
 * kolom yang pernah ke-format Time oleh Sheets (mis. terisi manual lewat
 * UI Sheets sebelum kolomnya dipaksa format teks) membuat setValues()
 * berikutnya ikut dikonversi jadi serial tanggal/jam, lalu
 * Utils_sheetToObjects_ men-toISOString()-kan-nya jadi string aneh
 * ("1899-12-30T02:17:24.000Z"). Fungsi ini menormalkan APAPUN bentuknya
 * (Date mentah, ISO string korup, atau "HH:MM" yang sudah benar) balik
 * ke "HH:MM" di timezone spreadsheet central — dipakai di setiap titik
 * baca supaya data lama yang sudah kadung korup tetap tampil benar,
 * sekaligus jadi jaring pengaman kalau Config_ensureTextFormatColumns_
 * belum sempat membersihkan sumber datanya.
 */
function Jadwal_normalizeJam_(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (Jadwal_validateJam_(s)) return s;
  const d = (v instanceof Date) ? v : new Date(s);
  if (isNaN(d.getTime())) return '';
  const tz = Config_getCentralSpreadsheet_().getSpreadsheetTimeZone();
  return Utilities.formatDate(d, tz, 'HH:mm');
}

/**
 * Jadwal_isBentrokInSheet_(sh, hari, jamMulai, jamSelesai, tahunAjaranId, semester, excludeJadwalId)
 * Cek tumpang tindih jam pada sheet JADWAL pribadi SATU guru — sudah
 * terlingkup ke satu guru karena sheet-nya sendiri per-guru, jadi tidak
 * perlu filter guru_id lagi (beda dari versi lama yang bekerja di sheet
 * central berisi semua guru).
 */
function Jadwal_isBentrokInSheet_(sh, hari, jamMulai, jamSelesai, tahunAjaranId, semester, excludeJadwalId) {
  const rows = Utils_sheetToObjects_(sh).filter(function (r) {
    return r.hari === hari && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester &&
      r.jadwal_id !== excludeJadwalId && String(r.status).toUpperCase() === 'AKTIF';
  });
  return rows.some(function (r) { return jamMulai < r.jam_selesai && jamSelesai > r.jam_mulai; });
}

/**
 * adminGetSchedules(sekolahId)
 * SUPERADMIN only, sekolahId WAJIB (bukan lagi opsional) — jadwal
 * sekarang tersimpan di spreadsheet masing-masing guru, jadi menampilkan
 * ini berarti membuka spreadsheet tiap guru di sekolah itu satu per satu;
 * dibatasi per sekolah supaya tidak membuka puluhan/ratusan spreadsheet
 * sekaligus untuk seluruh sistem. Guru yang belum pernah login (belum
 * ada spreadsheet) atau yang aksesnya belum berhasil dibagikan ke
 * Superadmin dilewati saja (tidak menggagalkan tampilan guru lain).
 */
function adminGetSchedules(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  sekolahId = String(sekolahId || '').trim();
  if (!sekolahId) throw new Error('Pilih sekolah dulu.');

  const guruList = Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')).filter(function (r) {
    return String(r.sekolah_id) === sekolahId;
  });

  const out = [];
  guruList.forEach(function (guru) {
    const entry = Guru_findResourceMapByGuruId_(guru.guru_id);
    if (!entry || !entry.spreadsheet_id) return;
    try {
      const ss = SpreadsheetApp.openById(entry.spreadsheet_id);
      Utils_sheetToObjects_(ss.getSheetByName('JADWAL')).filter(function (r) {
        return String(r.status).toUpperCase() === 'AKTIF';
      }).forEach(function (r) {
        out.push({
          jadwal_id: r.jadwal_id, guru_id: guru.guru_id, nama_guru: guru.nama_lengkap, sekolah_id: sekolahId,
          mapel_id: r.mapel_id, nama_mapel: r.nama_mapel || '-', kelas_id: r.kelas_id, nama_kelas: r.nama_kelas || '-',
          hari: r.hari, jam_mulai: Jadwal_normalizeJam_(r.jam_mulai), jam_selesai: Jadwal_normalizeJam_(r.jam_selesai),
          tahun_ajaran_id: r.tahun_ajaran_id, semester: r.semester, status: r.status
        });
      });
    } catch (e) {
      // Belum punya akses ke spreadsheet guru ini — lewati, jangan
      // gagalkan tampilan guru lain yang datanya bisa dibaca.
    }
  });
  return out;
}

/* ================= Guru: lihat + kelola jadwal sendiri langsung ================= */

function getMySchedule() {
  const auth = Security_requireRole_(['GURU']);
  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  return Utils_sheetToObjects_(ss.getSheetByName('JADWAL')).map(function (r) {
    delete r._row;
    r.jam_mulai = Jadwal_normalizeJam_(r.jam_mulai);
    r.jam_selesai = Jadwal_normalizeJam_(r.jam_selesai);
    return r;
  });
}

/**
 * Jadwal_assertGuruAssignment_(auth, mapelId, kelasId, tahunAjaranId)
 * Guru cuma boleh menjadwalkan kombinasi mapel+kelas+tahun ajaran yang
 * memang penugasannya (PENUGASAN_MENGAJAR aktif) — supaya jadwal
 * langsung guru tidak bisa "mengklaim" kelas/mapel yang bukan miliknya.
 */
function Jadwal_assertGuruAssignment_(auth, mapelId, kelasId, tahunAjaranId) {
  const ok = Utils_sheetToObjects_(Config_getSheet_('PENUGASAN_MENGAJAR')).some(function (r) {
    return r.guru_id === auth.guruId && r.mapel_id === mapelId && r.kelas_id === kelasId &&
      r.tahun_ajaran_id === tahunAjaranId && String(r.status).toUpperCase() === 'AKTIF';
  });
  if (!ok) throw new Error('Anda tidak memiliki penugasan mengajar untuk kombinasi mapel & kelas ini.');
}

/**
 * createMySchedule(data) / updateMySchedule(jadwalId, data) / deleteMySchedule(jadwalId)
 * Guru mengelola jadwalnya sendiri langsung (tanpa approval Superadmin) —
 * langsung tulis ke sheet JADWAL di spreadsheet PRIBADI guru sendiri
 * (Config_getGuruSpreadsheet_), yang juga dibaca getMySchedule. nama_mapel
 * /nama_kelas disimpan langsung di baris (denormalized) lewat
 * Jadwal_lookupNames_ supaya getMySchedule tidak perlu join ke sheet
 * central lagi.
 */
function Jadwal_lookupNames_(mapelId, kelasId) {
  const mapel = Utils_sheetToObjects_(Config_getSheet_('MASTER_MAPEL')).filter(function (r) { return r.mapel_id === mapelId; })[0];
  const kelas = Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')).filter(function (r) { return r.kelas_id === kelasId; })[0];
  return { nama_mapel: (mapel && mapel.nama_mapel) || '-', nama_kelas: (kelas && kelas.nama_kelas) || '-' };
}

function createMySchedule(data) {
  const auth = Security_requireRole_(['GURU']);
  const mapelId = String(data && data.mapel_id || '').trim();
  const kelasId = String(data && data.kelas_id || '').trim();
  const tahunAjaranId = String(data && data.tahun_ajaran_id || '').trim();
  const hari = String(data && data.hari || '').toUpperCase().trim();
  const jamMulai = String(data && data.jam_mulai || '').trim();
  const jamSelesai = String(data && data.jam_selesai || '').trim();

  if (!mapelId || !kelasId || !tahunAjaranId) throw new Error('Mapel, kelas, dan tahun ajaran wajib diisi.');
  if (JADWAL_HARI_VALID_.indexOf(hari) === -1) throw new Error('Hari tidak valid.');
  if (!Jadwal_validateJam_(jamMulai) || !Jadwal_validateJam_(jamSelesai)) throw new Error('Format jam harus HH:MM.');
  if (jamMulai >= jamSelesai) throw new Error('Jam mulai harus lebih awal dari jam selesai.');
  Jadwal_assertGuruAssignment_(auth, mapelId, kelasId, tahunAjaranId);

  const semester = TahunAjaran_getSemester_(tahunAjaranId);
  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const sh = ss.getSheetByName('JADWAL');
  if (Jadwal_isBentrokInSheet_(sh, hari, jamMulai, jamSelesai, tahunAjaranId, semester, null)) {
    throw new Error('Jadwal bentrok dengan jadwal Anda yang lain di hari & jam yang sama.');
  }

  const names = Jadwal_lookupNames_(mapelId, kelasId);
  const jadwalId = Utils_newId_('JDW');
  Utils_appendRowByHeader_(sh, {
    jadwal_id: jadwalId, mapel_id: mapelId, nama_mapel: names.nama_mapel, kelas_id: kelasId, nama_kelas: names.nama_kelas,
    hari: hari, jam_mulai: jamMulai, jam_selesai: jamSelesai, ruangan: '', keterangan: '',
    tahun_ajaran_id: tahunAjaranId, semester: semester, status: 'AKTIF'
  });

  AuditLog_write_(auth, 'CREATE_SCHEDULE_SELF', 'Jadwal', jadwalId, hari + ' ' + jamMulai + '-' + jamSelesai);
  Dashboard_invalidateCache_(auth.guruId);
  return { jadwal_id: jadwalId };
}

/**
 * updateMySchedule(jadwalId, data)
 * Selain hari/jam, guru juga bisa ganti mapel_id+kelas_id (mis. salah
 * pilih kelas saat menambah) — kombinasi baru tetap wajib penugasan
 * aktif miliknya sendiri (Jadwal_assertGuruAssignment_), tahun_ajaran_id
 * +semester ikut disegarkan mengikuti mapel/kelas yang baru.
 */
function updateMySchedule(jadwalId, data) {
  const auth = Security_requireRole_(['GURU']);
  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const sh = ss.getSheetByName('JADWAL');
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.jadwal_id === jadwalId; })[0];
  if (!row) throw new Error('Jadwal tidak ditemukan.');

  const hari = data.hari !== undefined ? String(data.hari).toUpperCase().trim() : row.hari;
  const jamMulai = data.jam_mulai !== undefined ? String(data.jam_mulai).trim() : row.jam_mulai;
  const jamSelesai = data.jam_selesai !== undefined ? String(data.jam_selesai).trim() : row.jam_selesai;
  const mapelId = data.mapel_id !== undefined ? String(data.mapel_id).trim() : row.mapel_id;
  const kelasId = data.kelas_id !== undefined ? String(data.kelas_id).trim() : row.kelas_id;
  const tahunAjaranId = data.tahun_ajaran_id !== undefined ? String(data.tahun_ajaran_id).trim() : row.tahun_ajaran_id;
  if (JADWAL_HARI_VALID_.indexOf(hari) === -1) throw new Error('Hari tidak valid.');
  if (!Jadwal_validateJam_(jamMulai) || !Jadwal_validateJam_(jamSelesai)) throw new Error('Format jam harus HH:MM.');
  if (jamMulai >= jamSelesai) throw new Error('Jam mulai harus lebih awal dari jam selesai.');
  const semester = tahunAjaranId !== row.tahun_ajaran_id ? TahunAjaran_getSemester_(tahunAjaranId) : row.semester;
  if (mapelId !== row.mapel_id || kelasId !== row.kelas_id || tahunAjaranId !== row.tahun_ajaran_id) {
    Jadwal_assertGuruAssignment_(auth, mapelId, kelasId, tahunAjaranId);
  }

  if (Jadwal_isBentrokInSheet_(sh, hari, jamMulai, jamSelesai, tahunAjaranId, semester, jadwalId)) {
    throw new Error('Jadwal bentrok dengan jadwal Anda yang lain di hari & jam yang sama.');
  }

  const names = Jadwal_lookupNames_(mapelId, kelasId);
  const patch = {
    hari: hari, jam_mulai: jamMulai, jam_selesai: jamSelesai, mapel_id: mapelId, nama_mapel: names.nama_mapel,
    kelas_id: kelasId, nama_kelas: names.nama_kelas, tahun_ajaran_id: tahunAjaranId, semester: semester
  };
  Utils_updateRowByHeader_(sh, row._row, patch);

  AuditLog_write_(auth, 'UPDATE_SCHEDULE_SELF', 'Jadwal', jadwalId, JSON.stringify(patch));
  Dashboard_invalidateCache_(auth.guruId);
  return { ok: true };
}

function deleteMySchedule(jadwalId) {
  const auth = Security_requireRole_(['GURU']);
  const ss = Config_getGuruSpreadsheet_(auth.guruId);
  const sh = ss.getSheetByName('JADWAL');
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.jadwal_id === jadwalId; })[0];
  if (!row) throw new Error('Jadwal tidak ditemukan.');

  Utils_deleteRowById_(sh, 'jadwal_id', jadwalId);
  AuditLog_write_(auth, 'DELETE_SCHEDULE_SELF', 'Jadwal', jadwalId, auth.guruId);
  Dashboard_invalidateCache_(auth.guruId);
  return { ok: true };
}

/**
 * Jadwal_migrateGuruToOwnSheet_(guruId, newSs)
 * Dipanggil SEKALI dari Guru_migrateToOwnAccount_ (Guru.gs) saat guru
 * lama (arsitektur sebelum perubahan ini) pindah ke spreadsheet
 * miliknya sendiri — jadwalnya masih tersimpan di sheet central
 * JADWAL_MENGAJAR (skema lama), belum di sheet JADWAL pribadi (yang
 * skemanya beda: sudah menyimpan nama_mapel/nama_kelas langsung).
 * Disalin dengan enrichment supaya guru tidak kehilangan jadwalnya
 * setelah migrasi.
 */
function Jadwal_migrateGuruToOwnSheet_(guruId, newSs) {
  try {
    const sh = newSs.getSheetByName('JADWAL');
    if (!sh) return;
    const mapelById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_MAPEL')), 'mapel_id');
    const kelasById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')), 'kelas_id');
    const rows = Utils_sheetToObjects_(Config_getSheet_('JADWAL_MENGAJAR')).filter(function (r) {
      return r.guru_id === guruId && String(r.status).toUpperCase() === 'AKTIF';
    }).map(function (r) {
      const m = mapelById[r.mapel_id] || {};
      const k = kelasById[r.kelas_id] || {};
      return [
        r.jadwal_id, r.mapel_id, m.nama_mapel || '-', r.kelas_id, k.nama_kelas || '-',
        r.hari, Jadwal_normalizeJam_(r.jam_mulai), Jadwal_normalizeJam_(r.jam_selesai),
        r.ruangan || '', r.keterangan || '', r.tahun_ajaran_id, r.semester, r.status
      ];
    });
    if (rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  } catch (e) {
    Utils_logError_('MIGRATE_JADWAL_' + guruId, e);
  }
}
