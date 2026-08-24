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
    header.forEach(function (key, c) { obj[key] = values[i][c]; });
    obj._row = i + 1; // hanya untuk keperluan internal update-by-position, TIDAK dipakai sebagai ID publik
    rows.push(obj);
  }
  return rows;
}

/**
 * Utils_logError_(context, err)
 * Catat error ke sheet central _LOG_ERROR_. Tidak pernah throw.
 */
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
