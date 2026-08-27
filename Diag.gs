// Diag.gs — utilitas diagnostik ringan untuk Superadmin. Tidak dipakai
// alur bisnis apa pun, murni bantu troubleshoot dari UI tanpa perlu akses
// Apps Script Editor langsung.

function adminGetCentralSpreadsheetInfo() {
  Security_requireRole_(['SUPERADMIN']);
  const ss = Config_getCentralSpreadsheet_();
  const sheets = ss.getSheets().map(function (sh) {
    return { name: sh.getName(), rows: sh.getLastRow(), cols: sh.getLastColumn() };
  });
  return { id: ss.getId(), url: ss.getUrl(), sheets: sheets };
}

// Sheet operasional guru yang ditambahkan setelah provisioning awal
// (modul Nilai Akhir, Katrol) — daftar dicek satu per satu di
// adminMigrateGuruOperationalSheets di bawah. Tambah nama sheet baru ke
// sini tiap kali modul baru menambah sheet ke CONFIG_GURU_OPERATIONAL_SCHEMA_.
const DIAG_GURU_SHEETS_TO_MIGRATE_ = ['NILAI_AKHIR', 'KATROL_HISTORY', 'JADWAL'];

/**
 * adminMigrateGuruOperationalSheets()
 * Dua hal, sekali klik untuk SEMUA guru:
 *
 * 1. Sheet operasional guru yang ditambahkan BELAKANGAN (NILAI_AKHIR,
 *    KATROL_HISTORY) otomatis ada di spreadsheet guru yang BARU diprovisi,
 *    tapi guru lama yang spreadsheet-nya dibuat sebelum modul itu ada
 *    tidak otomatis dapat — dilengkapi di sini lewat Config_ensureGuruSheet_.
 *    Ini masih aman dijalankan sebagai Superadmin selama Superadmin sudah
 *    punya akses Editor ke spreadsheet itu (kalau belum, masuk ke daftar
 *    failed dan otomatis diperbaiki lewat poin 2 di bawah).
 *
 * 2. Menandai needs_resync='YES' di SEMUA baris RESOURCE_MAP sekaligus —
 *    bulk version dari tombol "Tandai Perbaikan Akses" per guru
 *    (adminReprovisionTeacher). Superadmin TIDAK BISA memberi dirinya
 *    sendiri akses ke spreadsheet yang dia bukan pemilik/editor-nya, jadi
 *    perbaikan sesungguhnya (bagikan ulang akses ke Superadmin, dan kalau
 *    perlu pindahkan kepemilikan spreadsheet lama ke akun guru sendiri)
 *    baru terjadi otomatis saat guru itu SENDIRI login berikutnya — lihat
 *    Guru_ensureOwnSpreadsheet_ di Guru.gs.
 */
function adminMigrateGuruOperationalSheets() {
  const auth = Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('RESOURCE_MAP');
  const entries = Utils_sheetToObjects_(sh).filter(function (r) {
    return String(r.status).toLowerCase() === 'active' && r.spreadsheet_id;
  });

  let migrated = 0;
  const failed = [];
  entries.forEach(function (r) {
    try {
      const ss = SpreadsheetApp.openById(r.spreadsheet_id);
      let touchedAny = false;
      DIAG_GURU_SHEETS_TO_MIGRATE_.forEach(function (sheetName) {
        const already = !!ss.getSheetByName(sheetName);
        Config_ensureGuruSheet_(ss, sheetName);
        if (!already) touchedAny = true;
      });
      if (touchedAny) migrated++;
    } catch (e) {
      failed.push({ guru_id: r.guru_id, email: r.email, error: String(e.message || e) });
    }
    try {
      Utils_updateRowByHeader_(sh, r._row, { needs_resync: 'YES' });
    } catch (e2) { /* baris ini tetap dicoba lagi di klik berikutnya */ }
  });

  AuditLog_write_(auth, 'BULK_FLAG_TEACHER_RESYNC', 'Guru', '-', entries.length + ' guru ditandai');
  return { total: entries.length, migrated: migrated, failed: failed };
}
