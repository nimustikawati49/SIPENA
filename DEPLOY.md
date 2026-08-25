# Deploy SIPENA (Phase 1)

## Status: sudah dideploy

- **URL aplikasi**: https://script.google.com/macros/s/AKfycbw8BIsTrdImoU9I1ueyGOzajTwFvHAD8tKMaWrrIG24cE6d9n2aMimKBJDqNltPKe5R/exec
- Apps Script project: dibuat via `clasp create-script --type standalone --title "SIPENA"`
- Deployment id: `AKfycbw8BIsTrdImoU9I1ueyGOzajTwFvHAD8tKMaWrrIG24cE6d9n2aMimKBJDqNltPKe5R` (versi 1, deskripsi "Phase 1 - skeleton auth")
- Login pemilik: `nimustikawati49@guru.smp.belajar.id` (otomatis jadi Superadmin pertama, lihat `CONFIG_SUPERADMIN_BOOTSTRAP_EMAIL` di `Config.gs`)

**Yang masih perlu Anda lakukan manual** (butuh akses ke Settings repo GitHub,
tidak bisa dari clasp/CLI):
1. Buka URL di atas, login dengan email Anda, dan konfirmasi kartu SIPENA
   muncul dengan role **SUPERADMIN**.
2. (Opsional) Aktifkan GitHub Pages: repo **Settings > Pages > Source:
   branch `main`, folder `/docs`** — supaya `docs/index.html` (redirect ke
   URL di atas) bisa diakses lewat `https://nimustikawati49.github.io/SIPENA/`.

---

## Referensi: langkah dari nol (untuk redeploy / project baru)

Dijalankan dari folder `sipena/` di komputer yang sudah `clasp login`.

```
clasp create-script --type standalone --title "SIPENA"
```
> Catatan: clasp v3 tidak punya `--type webapp` (itu bukan tipe container,
> cuma konfigurasi deployment) — pakai `standalone`, lalu web app diatur
> lewat `appsscript.json` (`webapp.executeAs`/`webapp.access`, sudah diisi)
> dan langkah deploy di bawah. Perintah ini **menimpa** `appsscript.json`
> lokal dengan manifest default kosong — cek dan kembalikan isinya sebelum
> push kalau itu terjadi lagi.

```
clasp push --force
clasp create-deployment --description "deskripsi versi ini"
clasp list-deployments
```

URL web app = `https://script.google.com/macros/s/<deploymentId>/exec`
(ambil `<deploymentId>` dari `list-deployments`, baris yang punya versi
angka — bukan `@HEAD`).

## Verifikasi

Buka URL `/exec` — harus muncul kartu SIPENA menampilkan email Anda dan
role **SUPERADMIN** untuk login pertama. Kalau login dengan email lain yang
belum terdaftar di `MASTER_GURU`, harus muncul pesan "Akun belum terdaftar.
Hubungi Superadmin."

Setelah ini terverifikasi, Phase 2 (master data: sekolah, guru, mapel,
kelas, penugasan) bisa mulai.

## Redeploy setelah ubah kode

```
clasp push
clasp create-deployment --deploymentId <deploymentId-yang-sudah-ada> --description "update"
```
