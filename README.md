# SIPENA

**Sistem Pencatatan Penilaian Guru**

Aplikasi web untuk membantu guru mengelola dashboard, profil, mata
pelajaran, penugasan, jadwal, kelas, siswa, penilaian (nilai murni &
katrol), tahun ajaran, kenaikan kelas, kelulusan, alumni, siswa baru,
siswa pindahan, dan mutasi siswa — mendukung SD, SMP, SMA, dan SMK,
multi-sekolah dan multi-guru dengan isolasi data guru yang ketat.

## Arsitektur

Single **Google Apps Script Web App** — `doGet()` menyajikan seluruh
frontend (`HtmlService` + `google.script.run`, tanpa CORS/fetch lintas
origin). Identitas login otomatis via Google Workspace SSO
(`Session.getEffectiveUser()`), tanpa form login manual.

Setiap guru punya **1 Google Spreadsheet operasional sendiri**
(auto-provisioned oleh Superadmin), dipetakan lewat sheet central
`RESOURCE_MAP`. Data antar guru dan antar sekolah terisolasi penuh —
lihat blueprint arsitektur untuk detail lengkap (model data, alur
otorisasi, workflow kenaikan kelas/mutasi, dsb).

Referensi pola implementasi (auth, caching, batch I/O, export,
non-destructive history) diadaptasi dari project
[SAG](https://github.com/nimustikawati49/SAG) milik penulis yang sama.

## Status

**Phase 1** — skeleton auth & role resolution (`SUPERADMIN` / `GURU`).
Lihat [`DEPLOY.md`](DEPLOY.md) untuk cara deploy dan verifikasi.

## Struktur

```
Code.gs        doGet(), include(), konstanta aplikasi
Security.gs    guard terpusat: requireAuth_/requireRole_/requireOwnership_
Auth.gs        resolusi identitas & role dari email
Config.gs      koneksi spreadsheet central, bootstrap skema
Utils.gs       ID generator, header-index reader, error logger
index.html     entry point HtmlService
layout.html    shell UI
styles.html    CSS (light/dark aware)
scripts-init.html  bootstrap client (google.script.run)
docs/          halaman redirect GitHub Pages (opsional)
```
