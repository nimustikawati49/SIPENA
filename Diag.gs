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
