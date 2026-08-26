// Jadwal.gs — Phase 5. Jadwal RESMI diinput SUPERADMIN (spec §36) — guru
// tidak bisa mengubahnya langsung, hanya "Ajukan Perubahan Jadwal"
// (REQUEST_JADWAL_PERUBAHAN) yang Superadmin approve/reject (spec §37).

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
 * Jadwal_isBentrok_(guruId, hari, jamMulai, jamSelesai, tahunAjaranId, semester, excludeJadwalId)
 * Cek tumpang tindih jam pada guru+hari+periode yang sama — perbandingan
 * string "HH:MM" valid secara leksikografis untuk overlap check.
 */
function Jadwal_isBentrok_(guruId, hari, jamMulai, jamSelesai, tahunAjaranId, semester, excludeJadwalId) {
  const rows = Utils_sheetToObjects_(Config_getSheet_('JADWAL_MENGAJAR')).filter(function (r) {
    return r.guru_id === guruId && r.hari === hari && r.tahun_ajaran_id === tahunAjaranId && r.semester === semester &&
      r.jadwal_id !== excludeJadwalId && String(r.status).toUpperCase() === 'AKTIF';
  });
  return rows.some(function (r) { return jamMulai < r.jam_selesai && jamSelesai > r.jam_mulai; });
}

function Jadwal_enrichWithNames_(rows) {
  const guruById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')), 'guru_id');
  const mapelById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_MAPEL')), 'mapel_id');
  const kelasById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_KELAS')), 'kelas_id');
  return rows.map(function (r) {
    return Object.assign({}, r, {
      nama_guru: (guruById[r.guru_id] || {}).nama_lengkap || '-',
      nama_mapel: (mapelById[r.mapel_id] || {}).nama_mapel || '-',
      nama_kelas: (kelasById[r.kelas_id] || {}).nama_kelas || '-',
      jam_mulai: Jadwal_normalizeJam_(r.jam_mulai),
      jam_selesai: Jadwal_normalizeJam_(r.jam_selesai)
    });
  });
}

function adminGetSchedules(sekolahId) {
  Security_requireRole_(['SUPERADMIN']);
  const rows = Utils_sheetToObjects_(Config_getSheet_('JADWAL_MENGAJAR')).map(function (r) { delete r._row; return r; });
  const filtered = sekolahId ? rows.filter(function (r) { return r.sekolah_id === sekolahId; }) : rows;
  return Jadwal_enrichWithNames_(filtered);
}

function adminCreateSchedule(data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const guruId = String(data && data.guru_id || '').trim();
  const mapelId = String(data && data.mapel_id || '').trim();
  const kelasId = String(data && data.kelas_id || '').trim();
  const tahunAjaranId = String(data && data.tahun_ajaran_id || '').trim();
  const hari = String(data && data.hari || '').toUpperCase().trim();
  const jamMulai = String(data && data.jam_mulai || '').trim();
  const jamSelesai = String(data && data.jam_selesai || '').trim();

  if (!guruId || !mapelId || !kelasId || !tahunAjaranId) throw new Error('Guru, mapel, kelas, dan tahun ajaran wajib diisi.');
  if (JADWAL_HARI_VALID_.indexOf(hari) === -1) throw new Error('Hari tidak valid.');
  if (!Jadwal_validateJam_(jamMulai) || !Jadwal_validateJam_(jamSelesai)) throw new Error('Format jam harus HH:MM.');
  if (jamMulai >= jamSelesai) throw new Error('Jam mulai harus lebih awal dari jam selesai.');

  const guru = Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')).filter(function (r) { return r.guru_id === guruId; })[0];
  if (!guru) throw new Error('Guru tidak ditemukan.');
  const semester = TahunAjaran_getSemester_(tahunAjaranId);

  if (Jadwal_isBentrok_(guruId, hari, jamMulai, jamSelesai, tahunAjaranId, semester, null)) {
    throw new Error('Jadwal bentrok dengan jadwal lain milik guru ini di hari & jam yang sama.');
  }

  const jadwalId = Utils_newId_('JDW');
  Utils_appendRowByHeader_(Config_getSheet_('JADWAL_MENGAJAR'), {
    jadwal_id: jadwalId, guru_id: guruId, mapel_id: mapelId, kelas_id: kelasId, sekolah_id: guru.sekolah_id,
    tahun_ajaran_id: tahunAjaranId, semester: semester, hari: hari, jam_mulai: jamMulai, jam_selesai: jamSelesai,
    ruangan: data.ruangan || '', keterangan: data.keterangan || '', status: 'AKTIF'
  });

  AuditLog_write_(auth, 'CREATE_SCHEDULE', 'Jadwal', jadwalId, guru.nama_lengkap + ' ' + hari + ' ' + jamMulai + '-' + jamSelesai);
  Sync_teacherData_(guruId);
  return { jadwal_id: jadwalId };
}

function adminUpdateSchedule(jadwalId, data) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('JADWAL_MENGAJAR');
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.jadwal_id === jadwalId; })[0];
  if (!row) throw new Error('Jadwal tidak ditemukan.');

  const hari = data.hari !== undefined ? String(data.hari).toUpperCase().trim() : row.hari;
  const jamMulai = data.jam_mulai !== undefined ? String(data.jam_mulai).trim() : row.jam_mulai;
  const jamSelesai = data.jam_selesai !== undefined ? String(data.jam_selesai).trim() : row.jam_selesai;
  if (JADWAL_HARI_VALID_.indexOf(hari) === -1) throw new Error('Hari tidak valid.');
  if (!Jadwal_validateJam_(jamMulai) || !Jadwal_validateJam_(jamSelesai)) throw new Error('Format jam harus HH:MM.');
  if (jamMulai >= jamSelesai) throw new Error('Jam mulai harus lebih awal dari jam selesai.');

  if (Jadwal_isBentrok_(row.guru_id, hari, jamMulai, jamSelesai, row.tahun_ajaran_id, row.semester, jadwalId)) {
    throw new Error('Jadwal bentrok dengan jadwal lain milik guru ini di hari & jam yang sama.');
  }

  const patch = { hari: hari, jam_mulai: jamMulai, jam_selesai: jamSelesai };
  ['ruangan', 'keterangan', 'status'].forEach(function (k) { if (data[k] !== undefined) patch[k] = data[k]; });
  Utils_updateRowByHeader_(sh, row._row, patch);

  AuditLog_write_(auth, 'UPDATE_SCHEDULE', 'Jadwal', jadwalId, JSON.stringify(patch));
  Sync_teacherData_(row.guru_id);
  return { ok: true };
}

function adminDeleteSchedule(jadwalId) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('JADWAL_MENGAJAR');
  const row = Utils_sheetToObjects_(sh).filter(function (r) { return r.jadwal_id === jadwalId; })[0];
  if (!row) throw new Error('Jadwal tidak ditemukan.');

  Utils_deleteRowById_(sh, 'jadwal_id', jadwalId);
  AuditLog_write_(auth, 'DELETE_SCHEDULE', 'Jadwal', jadwalId, row.guru_id);
  Sync_teacherData_(row.guru_id);
  return { ok: true };
}

/* ================= Guru: lihat jadwal + ajukan perubahan ================= */

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
 * requestScheduleChange(jadwalId, perubahan, alasan)
 * perubahan: {hari?, jam_mulai?, jam_selesai?, ruangan?} — field yang
 * ingin diubah guru. TIDAK langsung mengubah JADWAL_MENGAJAR — hanya
 * membuat baris PENDING di REQUEST_JADWAL_PERUBAHAN untuk ditinjau
 * Superadmin (spec §37).
 */
function requestScheduleChange(jadwalId, perubahan, alasan) {
  const auth = Security_requireRole_(['GURU']);
  const jadwalRow = Utils_sheetToObjects_(Config_getSheet_('JADWAL_MENGAJAR')).filter(function (r) { return r.jadwal_id === jadwalId; })[0];
  if (!jadwalRow) throw new Error('Jadwal tidak ditemukan.');
  if (jadwalRow.guru_id !== auth.guruId) throw new Error('AKSES_DITOLAK: Jadwal ini bukan milik Anda.');
  if (!perubahan || !Object.keys(perubahan).length) throw new Error('Tidak ada perubahan yang diajukan.');
  if (!String(alasan || '').trim()) throw new Error('Alasan pengajuan wajib diisi.');

  const requestId = Utils_newId_('RJ');
  Utils_appendRowByHeader_(Config_getSheet_('REQUEST_JADWAL_PERUBAHAN'), {
    request_id: requestId, guru_id: auth.guruId, jadwal_id_terkait: jadwalId,
    perubahan_json: JSON.stringify(perubahan), alasan: alasan, requested_at: new Date(), status: 'PENDING'
  });

  AuditLog_write_(auth, 'REQUEST_SCHEDULE_CHANGE', 'Jadwal', requestId, JSON.stringify(perubahan));
  return { request_id: requestId };
}

function getMyScheduleRequests() {
  const auth = Security_requireRole_(['GURU']);
  return Utils_sheetToObjects_(Config_getSheet_('REQUEST_JADWAL_PERUBAHAN'))
    .filter(function (r) { return r.guru_id === auth.guruId; })
    .map(function (r) { delete r._row; return r; })
    .sort(function (a, b) { return new Date(b.requested_at) - new Date(a.requested_at); });
}

/* ================= Superadmin: tinjau pengajuan ================= */

function adminGetScheduleRequests(status) {
  Security_requireRole_(['SUPERADMIN']);
  const guruById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('MASTER_GURU')), 'guru_id');
  const jadwalById = Penugasan_indexBy_(Utils_sheetToObjects_(Config_getSheet_('JADWAL_MENGAJAR')), 'jadwal_id');
  let rows = Utils_sheetToObjects_(Config_getSheet_('REQUEST_JADWAL_PERUBAHAN')).map(function (r) { delete r._row; return r; });
  if (status) rows = rows.filter(function (r) { return r.status === status; });
  return rows.map(function (r) {
    const j = jadwalById[r.jadwal_id_terkait] || {};
    return Object.assign({}, r, {
      nama_guru: (guruById[r.guru_id] || {}).nama_lengkap || '-',
      jadwal_saat_ini: j.hari ? (j.hari + ' ' + j.jam_mulai + '-' + j.jam_selesai + (j.ruangan ? ' (' + j.ruangan + ')' : '')) : '(jadwal tidak ditemukan)'
    });
  }).sort(function (a, b) { return new Date(b.requested_at) - new Date(a.requested_at); });
}

/**
 * adminProcessScheduleRequest(requestId, decision, catatan)
 * decision: 'APPROVED' | 'REJECTED'. APPROVED menerapkan perubahan_json
 * ke JADWAL_MENGAJAR (lewat adminUpdateSchedule, jadi validasi bentrok
 * tetap berlaku) lalu sinkron guru. REJECTED cuma menandai status,
 * jadwal resmi tidak tersentuh.
 */
function adminProcessScheduleRequest(requestId, decision, catatan) {
  const auth = Security_requireRole_(['SUPERADMIN']);
  if (['APPROVED', 'REJECTED'].indexOf(decision) === -1) throw new Error('Keputusan harus APPROVED atau REJECTED.');

  const sh = Config_getSheet_('REQUEST_JADWAL_PERUBAHAN');
  const req = Utils_sheetToObjects_(sh).filter(function (r) { return r.request_id === requestId; })[0];
  if (!req) throw new Error('Pengajuan tidak ditemukan.');
  if (req.status !== 'PENDING') throw new Error('Pengajuan ini sudah diproses sebelumnya (' + req.status + ').');

  if (decision === 'APPROVED') {
    const perubahan = JSON.parse(req.perubahan_json || '{}');
    adminUpdateSchedule(req.jadwal_id_terkait, perubahan);
  }

  Utils_updateRowByHeader_(sh, req._row, {
    status: decision, processed_by: auth.email, processed_at: new Date(), catatan: catatan || ''
  });

  AuditLog_write_(auth, 'PROCESS_SCHEDULE_REQUEST', 'Jadwal', requestId, decision);
  return { ok: true };
}
