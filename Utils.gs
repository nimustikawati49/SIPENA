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
