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

/**
 * adminMigrateNilaiAkhirSheets()
 * Sheet NILAI_AKHIR (modul Nilai Akhir) otomatis ada di spreadsheet guru
 * yang BARU diprovisi (sudah masuk CONFIG_GURU_OPERATIONAL_SCHEMA_), tapi
 * guru yang spreadsheet-nya dibuat SEBELUM modul ini tidak otomatis
 * dapat. Sengaja TIDAK dibuat lazy dari sisi guru (Nilai.gs) — spreadsheet
 * guru dimiliki Superadmin yang memprovisinya (SpreadsheetApp.create saat
 * eksekusi sebagai Superadmin), dan operasi struktural (insertSheet) dari
 * akun guru sendiri bisa ditolak izin Drive walau guru sudah bisa
 * baca/tulis SEL di spreadsheet yang sama — pernah menyebabkan getAuth()
 * gagal total untuk guru saat sheet central baru dibuat lazy dengan pola
 * serupa. Jadi migrasi ini dijalankan SEKALI oleh Superadmin (pemilik
 * file), bukan otomatis oleh guru.
 */
function adminMigrateNilaiAkhirSheets() {
  Security_requireRole_(['SUPERADMIN']);
  const entries = Utils_sheetToObjects_(Config_getSheet_('RESOURCE_MAP')).filter(function (r) {
    return String(r.status).toLowerCase() === 'active' && r.spreadsheet_id;
  });

  let migrated = 0;
  const failed = [];
  entries.forEach(function (r) {
    try {
      const ss = SpreadsheetApp.openById(r.spreadsheet_id);
      const already = !!ss.getSheetByName('NILAI_AKHIR');
      Config_ensureGuruSheet_(ss, 'NILAI_AKHIR');
      if (!already) migrated++;
    } catch (e) {
      failed.push({ guru_id: r.guru_id, email: r.email, error: String(e.message || e) });
    }
  });

  return { total: entries.length, migrated: migrated, failed: failed };
}
