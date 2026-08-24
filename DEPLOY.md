# Deploy SIPENA (Phase 1)

Kode sudah disiapkan lokal. Langkah ini dijalankan dari komputer Anda sendiri
(butuh login akun Google Workspace sekolah, bukan lewat Claude).

## 1. Install clasp (sekali saja)

```
npm install -g @google/clasp
clasp login
```

Login pakai akun Google yang akan jadi pemilik project Apps Script (akun
Workspace sekolah Anda — email ini otomatis jadi Superadmin pertama, lihat
`CONFIG_SUPERADMIN_BOOTSTRAP_EMAIL` di `Config.gs`).

## 2. Buat project Apps Script baru

Dari folder `sipena/`:

```
clasp create --type webapp --title "SIPENA"
```

Ini membuat `.clasp.json` (sengaja di-gitignore, isinya scriptId unik akun
Anda) dan project Apps Script baru yang kosong.

## 3. Push kode

```
clasp push
```

## 4. Deploy sebagai Web App

```
clasp deploy --description "Phase 1 - skeleton auth"
```

Atau lewat UI: buka `clasp open`, lalu **Deploy > New deployment > Web app**
— pastikan **Execute as: User accessing the web app**, **Who has access:
Anyone** (sudah diset di `appsscript.json`, tinggal konfirmasi).

Salin URL `.../exec` yang muncul.

## 5. (Opsional) Update redirect GitHub Pages

Ganti `REPLACE_WITH_EXEC_URL` di `docs/index.html` (2 tempat) dengan URL
`/exec` dari langkah 4, lalu commit+push. Setelah itu aktifkan GitHub Pages
di repo Settings > Pages > Source: `main` branch, folder `/docs`.

## 6. Verifikasi

Buka URL `/exec` — harus muncul kartu SIPENA menampilkan email Anda dan
role **SUPERADMIN** (bootstrap otomatis untuk login pertama). Kalau login
dengan email lain yang belum terdaftar, harus muncul pesan "Akun belum
terdaftar. Hubungi Superadmin."

Setelah ini terverifikasi, Phase 2 (master data: sekolah, guru, mapel,
kelas, penugasan) bisa mulai — lihat blueprint di riwayat percakapan atau
minta saya rangkum ulang.
