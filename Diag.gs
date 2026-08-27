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
 * Sheet operasional guru yang ditambahkan BELAKANGAN (NILAI_AKHIR, lalu
 * KATROL_HISTORY) otomatis ada di spreadsheet guru yang BARU diprovisi
 * (sudah masuk CONFIG_GURU_OPERATIONAL_SCHEMA_), tapi guru yang
 * spreadsheet-nya dibuat SEBELUM modul itu ada tidak otomatis dapat.
 * Sengaja TIDAK dibuat lazy dari sisi guru — spreadsheet guru dimiliki
 * Superadmin yang memprovisinya (SpreadsheetApp.create saat eksekusi
 * sebagai Superadmin), dan operasi struktural (insertSheet) dari akun
 * guru sendiri bisa ditolak izin Drive walau guru sudah bisa baca/tulis
 * SEL di spreadsheet yang sama — pernah menyebabkan getAuth() gagal total
 * untuk guru saat sheet central baru dibuat lazy dengan pola serupa. Jadi
 * migrasi ini dijalankan SEKALI oleh Superadmin (pemilik file), bukan
 * otomatis oleh guru. Config_ensureGuruSheet_ juga sekaligus melengkapi
 * kolom yang mungkin masih kurang di sheet yang SUDAH ada (mis.
 * nilai_kktp/kategori/status_ketercapaian di NILAI_AKHIR). Khusus JADWAL,
 * fungsi ini juga menulis ulang ISI-nya lewat Sync_rewriteJadwal_ (bukan
 * cuma kolom) supaya guru lama ikut dapat perbaikan nama_mapel/nama_kelas
 * yang sempat kosong dan jam_mulai/jam_selesai yang sempat korup jadi
 * serial Date — lihat Jadwal_normalizeJam_.
 *
 * PENTING: migrasi ini SELALU berjalan sebagai SUPERADMIN (pemilik file
 * — dibuat lewat SpreadsheetApp.create atas namanya), jadi berhasilnya
 * migrasi ini TIDAK MEMBUKTIKAN guru pemilik data itu sendiri bisa
 * mengakses spreadsheet-nya. Ditemukan belakangan bahwa spreadsheet
 * guru TIDAK PERNAH dibagikan eksplisit ke email guru (lihat
 * Guru_provisionSpreadsheet_) — jadi Guru_grantOwnSpreadsheetAccess_
 * sekarang ikut dijalankan di sini untuk SEMUA guru sekaligus, bukan
 * cuma satu-satu lewat "Provisi ulang" per guru.
 */
function adminMigrateGuruOperationalSheets() {
  Security_requireRole_(['SUPERADMIN']);
  const entries = Utils_sheetToObjects_(Config_getSheet_('RESOURCE_MAP')).filter(function (r) {
    return String(r.status).toLowerCase() === 'active' && r.spreadsheet_id;
  });

  let migrated = 0;
  const failed = [];
  entries.forEach(function (r) {
    try {
      const ss = SpreadsheetApp.openById(r.spreadsheet_id);
      Guru_grantOwnSpreadsheetAccess_(r.spreadsheet_id, r.email);
      let touchedAny = false;
      DIAG_GURU_SHEETS_TO_MIGRATE_.forEach(function (sheetName) {
        const already = !!ss.getSheetByName(sheetName);
        Config_ensureGuruSheet_(ss, sheetName);
        if (!already) touchedAny = true;
      });
      // JADWAL ditulis ulang PENUH tiap migrasi (bukan cuma dicek kolomnya)
      // supaya guru yang datanya sudah kadung korup (jam_mulai/jam_selesai
      // ke-simpan sebagai Date, atau nama_mapel/nama_kelas kosong karena
      // sheet-nya dibuat sebelum kolom itu ada) ikut diperbaiki tanpa harus
      // menunggu Superadmin mengubah jadwal guru itu lagi satu per satu.
      Sync_rewriteJadwal_(ss, r.guru_id);
      if (touchedAny) migrated++;
    } catch (e) {
      failed.push({ guru_id: r.guru_id, email: r.email, error: String(e.message || e) });
    }
  });

  return { total: entries.length, migrated: migrated, failed: failed };
}
