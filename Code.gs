// SIPENA — Sistem Informasi Penilaian dan Administrasi Guru
// Phase 1: skeleton web app + auth/role resolution end-to-end.
// Arsitektur: single Apps Script Web App (HtmlService + google.script.run),
// tidak ada frontend terpisah / CORS. Lihat blueprint di repo untuk detail.

/**************** WEB APP ENTRY POINT ****************/
function doGet(e) {
  const tmpl = HtmlService.createTemplateFromFile('index');
  return tmpl.evaluate()
    .setTitle('SIPENA — Sistem Informasi Penilaian dan Administrasi Guru')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

/** Server-side include helper, dipanggil dari index.html template. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

const APP_NAME = 'SIPENA';
