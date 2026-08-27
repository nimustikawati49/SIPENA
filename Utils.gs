// Utils.gs — helper umum. Prefix nama fungsi per modul (Utils_, Auth_, dst.)
// dipakai buat hindari bug shadowing nama fungsi lintas file (lihat catatan
// blueprint soal insiden _autoProvisionUserSpreadsheet_ ganda di SAG).

/**
 * Utils_newId_(prefix)
 * ID string tergenerate, tidak pernah nomor baris — dipakai di semua sheet.
 */
function Utils_newId_(prefix) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return prefix + '_' + ts + '_' + rand;
}

/**
 * Utils_headerIndex_(headerRow)
 * Peta nama kolom (lowercase, trim) -> index. Selalu dipakai untuk akses
 * kolom sheet — tidak pernah magic number seperti row[12].
 */
function Utils_headerIndex_(headerRow) {
  const idx = {};
  (headerRow || []).forEach(function (h, i) {
    idx[String(h || '').toLowerCase().trim()] = i;
  });
  return idx;
}

/**
 * Utils_sheetToObjects_(sh)
 * Baca seluruh sheet sekali (batch getValues), kembalikan array of object
 * berdasarkan header row. Sheet kosong/tidak ada -> [].
 */
function Utils_sheetToObjects_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const header = values[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    header.forEach(function (key, c) {
      const v = values[i][c];
      // Sel bertipe tanggal (created_at/updated_at dsb.) diserialisasi jadi
      // ISO string di sini, bukan dikirim sebagai Date mentah — Date yang
      // bersarang di dalam array-of-objects lewat batas google.script.run
      // dikenal tidak selalu ter-marshal dengan benar (bisa membuat SELURUH
      // response gagal tanpa pesan error yang jelas di client).
      obj[key] = (v instanceof Date) ? v.toISOString() : v;
    });
    obj._row = i + 1; // hanya untuk keperluan internal update-by-position, TIDAK dipakai sebagai ID publik
    rows.push(obj);
  }
  return rows;
}

/**
 * Utils_logError_(context, err)
 * Catat error ke sheet central _LOG_ERROR_. Tidak pernah throw.
 */
/**
 * Utils_writeExportSheetAndGetUrl_(ss, sheetName, headerRow, dataRows)
 * Tulis data ke sheet helper (bikin kalau belum ada, timpa isi lama
 * kalau sudah), lalu kembalikan URL export-xlsx NATIF Google Sheets
 * untuk sheet itu. Dipakai untuk semua fitur "Export Excel" — client-
 * side Blob download (mis. XLSX.writeFile) tidak bisa diandalkan jalan
 * di dalam iframe sandbox HtmlService (Apps Script menyajikan halaman
 * lewat iframe yang lazimnya tidak diizinkan memicu download berkas),
 * sementara window.open() ke URL export Sheets ini adalah navigasi
 * biasa ke domain lain sehingga tidak kena batasan itu — pola yang sama
 * dipakai SAG (Export.js) dan sudah terbukti jalan di produksi.
 */
function Utils_writeExportSheetAndGetUrl_(ss, sheetName, headerRow, dataRows) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  } else {
    sh.clear();
  }
  const allRows = [headerRow].concat(dataRows);
  sh.getRange(1, 1, allRows.length, headerRow.length).setValues(allRows);
  sh.getRange(1, 1, 1, headerRow.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  try { sh.autoResizeColumns(1, headerRow.length); } catch (e) {}
  return ss.getUrl().replace(/edit$/, 'export?format=xlsx&gid=' + sh.getSheetId());
}

/**
 * Utils_saveUploadedFile_(folderName, base64Data, mimeType, fileName, maxKb)
 * Simpan file yang diunggah (foto profil/tanda tangan) ke Drive milik
 * USER YANG SEDANG MENGAKSES (executeAs: USER_ACCESSING — jadi guru
 * upload ke Drive guru itu sendiri, Superadmin ke Drive Superadmin,
 * bukan numpuk di satu akun), lalu bagikan "siapa saja yang punya
 * link boleh lihat" supaya bisa ditampilkan sebagai <img src> di UI
 * tanpa perlu autentikasi ulang. Mengembalikan URL langsung-bisa-dilihat.
 */
function Utils_saveUploadedFile_(folderName, base64Data, mimeType, fileName, maxKb) {
  const limitKb = maxKb || 1500;
  const approxKb = Math.ceil((base64Data || '').length * 0.75 / 1024);
  if (approxKb > limitKb) throw new Error('Ukuran file terlalu besar (maks ' + limitKb + ' KB). Pilih foto yang lebih kecil.');

  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType, fileName || 'upload');
  const folder = Utils_getOrCreateFolder_(folderName);
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return 'https://drive.google.com/uc?export=view&id=' + file.getId();
}

function Utils_getOrCreateFolder_(name) {
  const iter = DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return DriveApp.createFolder(name);
}

function Utils_logError_(context, err) {
  try {
    const ss = Config_getCentralSpreadsheet_();
    let sh = ss.getSheetByName('_LOG_ERROR_');
    if (!sh) {
      sh = ss.insertSheet('_LOG_ERROR_');
      sh.appendRow(['timestamp', 'email', 'context', 'error', 'stack']);
      sh.setFrozenRows(1);
    }
    let email = 'system';
    try { email = Session.getEffectiveUser().getEmail(); } catch (e2) {}
    const msg = String(err && err.message ? err.message : err);
    const stack = String(err && err.stack ? err.stack : '');
    sh.appendRow([new Date(), email, String(context), msg, stack.substring(0, 500)]);
    Utils_trimLogSheet_(sh, 300);
  } catch (innerErr) { /* must not throw */ }
}

function Utils_trimLogSheet_(sh, maxRows) {
  try {
    const dataRows = sh.getLastRow() - 1;
    if (dataRows <= maxRows) return;
    sh.deleteRows(2, dataRows - maxRows);
  } catch (e) { /* jangan sampai trim gagal ganggu proses utama */ }
}

/**
 * Utils_appendRowByHeader_(sh, obj)
 * Tulis satu baris sesuai urutan header sheet (bukan urutan properti obj)
 * — supaya penambahan/penataan ulang kolom header tidak diam-diam
 * menggeser data yang ditulis modul lama.
 */
function Utils_appendRowByHeader_(sh, obj) {
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').toLowerCase().trim(); });
  const row = header.map(function (key) {
    const v = obj[key];
    return v === undefined || v === null ? '' : v;
  });
  sh.appendRow(row);
}

/**
 * Utils_findRowById_(sh, idColName, idValue)
 * Cari nomor baris (1-based, termasuk header) berdasarkan kolom ID.
 * Dipakai HANYA untuk lookup posisi tulis internal server — ID publik yang
 * dikirim ke client tetap string tergenerate, bukan nomor baris ini.
 */
function Utils_findRowById_(sh, idColName, idValue) {
  if (!sh || sh.getLastRow() < 2) return -1;
  const values = sh.getDataRange().getValues();
  const idx = Utils_headerIndex_(values[0]);
  const col = idx[String(idColName).toLowerCase()];
  if (col === undefined) return -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][col]) === String(idValue)) return i + 1;
  }
  return -1;
}

/**
 * Utils_deleteRowById_(sh, idColName, idValue)
 * Hapus satu baris berdasarkan kolom ID. Melempar Error kalau tidak
 * ditemukan — pemanggil (mis. adminDeleteSchool) yang menentukan apakah
 * boleh hard-delete atau harus dicegah karena masih direferensikan
 * record lain.
 */
function Utils_deleteRowById_(sh, idColName, idValue) {
  const rowNum = Utils_findRowById_(sh, idColName, idValue);
  if (rowNum === -1) throw new Error('Data tidak ditemukan.');
  sh.deleteRow(rowNum);
}

/**
 * Utils_updateRowByHeader_(sh, rowNum, patch)
 * Update sebagian kolom (patch = {kolom: nilai}) pada baris rowNum,
 * sisanya tidak tersentuh. Selalu header-indexed.
 */
function Utils_updateRowByHeader_(sh, rowNum, patch) {
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').toLowerCase().trim(); });
  Object.keys(patch).forEach(function (key) {
    const col = header.indexOf(String(key).toLowerCase());
    if (col === -1) return;
    sh.getRange(rowNum, col + 1).setValue(patch[key]);
  });
}

