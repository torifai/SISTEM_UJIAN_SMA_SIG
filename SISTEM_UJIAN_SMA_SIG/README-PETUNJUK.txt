SISTEM UJIAN ONLINE SMA SIG - PETUNJUK KONFIGURASI

ISI PAKET
- index.html, style.css, app.js, config.js
- netlify.toml dan netlify/functions/exam.js
- assets/background-sekolah.png (foto yang diunggah)

SEBELUM DEPLOY
1. Buka Code.gs dan isi SPREADSHEET_ID, LOGIN_TOKEN, SUBJECT_TOKENS, serta FORM_LINKS.
2. Pastikan Google Apps Script telah dijalankan/deploy sebagai Web App dengan akses yang sesuai untuk peserta.
3. Salin URL deployment Web App Google Apps Script.
4. Di Netlify, atur environment variable:
   GOOGLE_APPS_SCRIPT_URL = URL deployment Google Apps Script
5. Deploy seluruh isi folder ini ke Netlify.
6. Jalankan setupSheets() sekali dari editor Apps Script untuk membuat sheet database.

CATATAN PENTING
- File logo-sekolah.png belum disertakan karena belum diunggah. Header otomatis menyembunyikan area logo jika file tidak ada.
- Background memakai foto yang diunggah pengguna.
- Isi token, ID spreadsheet, URL Google Form, dan URL Apps Script belum diberikan sehingga masih harus diisi sendiri. Jangan membagikan token rahasia di tempat publik.
- Browser/perangkat tertentu tidak mendukung fullscreen. Tombol fullscreen meminta izin melalui interaksi peserta.
- Peringatan perpindahan tab/fullscreen adalah kontrol sisi browser; bukan pengganti pengawasan langsung. Peserta dapat mengalami false positive saat notifikasi atau pergantian aplikasi.
- Pastikan uji coba dengan akun dan token tes sebelum digunakan untuk ujian resmi.
