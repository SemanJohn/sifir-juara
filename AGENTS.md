# Nota untuk agen AI

Repo ini ialah **Sifir × Juara** — PWA permainan sifir satu-fail untuk murid sekolah rendah.

👉 **Baca [`BLUEPRINT.md`](./BLUEPRINT.md) sepenuhnya sebelum menyunting apa-apa.**

Ringkasan pantas:

- Seluruh aplikasi ada dalam `index.html` (~3,600 baris: HTML + CSS + JS dalam satu fail).
- JavaScript gaya **ES5** (`var`, `function(){}`). Tiada framework, tiada bundler, tiada npm.
- Tiada dependency luar kecuali Google Fonts. Ikon ialah SVG inline (`IKON`), bukan emoji.
- Semua teks UI, komen dan mesej commit dalam **Bahasa Melayu**.
- Backend: Google Apps Script (sumber kebenaran) + Firebase RTDB (baca sahaja, mempercepat).
- Mesti berfungsi pada telefon **dan** Android TV (navigasi D-pad).

Selepas setiap perubahan:

1. Naikkan `APP_VERSION` dalam `index.html`.
2. Naikkan `CACHE` dalam `sw.js` — jika terlupa, pengguna tersekat pada versi lama.
3. Uji manual: setiap mod, log masuk, VS, mod luar talian, D-pad.

Sunting secara setempat. **Jangan** jana semula keseluruhan `index.html`.
