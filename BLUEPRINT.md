# BLUEPRINT — Sifir × Juara

> **Dokumen rujukan untuk AI / agen kod.**
> Baca fail ini sepenuhnya sebelum menyunting apa-apa dalam repo `SemanJohn/sifir-juara`.
> Semua nombor baris merujuk kepada `index.html` pada **v5.3** (3,629 baris).
> Bahasa kod, UI dan komen ialah **Bahasa Melayu** — kekalkan bahasa itu.

---

## 1. Ringkasan projek

**Sifir × Juara** ialah PWA permainan latihan sifir (multiplication tables) untuk murid sekolah rendah Malaysia. Ia dibina sebagai **satu fail HTML tunggal** — HTML, CSS dan JavaScript semuanya dalam `index.html`, tanpa build step, tanpa bundler, tanpa framework, tanpa `node_modules`.

| Perkara | Nilai |
|---|---|
| Jenis | PWA (offline-capable), dihoskan di GitHub Pages |
| Bahasa UI | Bahasa Melayu (`<html lang="ms">`) |
| Sasaran peranti | Telefon (utama), tablet, desktop, **Android TV / Smart TV (D-pad)** |
| Versi semasa | `APP_VERSION = "5.3"` (baris 1037) |
| Cache service worker | `sifir-juara-v70` (`sw.js` baris 2) |
| Backend markah | Google Apps Script Web App (sumber kebenaran / *source of truth*) |
| Backend masa nyata | Firebase Realtime Database (baca sahaja, REST + SSE) |
| Dependency luar | **Hanya Google Fonts** (Fredoka + Nunito). Tiada yang lain. |

---

## 2. Struktur repo

```
sifir-juara/
├── index.html      # 3,629 baris — SELURUH aplikasi (HTML + CSS + JS)
├── sw.js           # Service worker, strategi cache
├── manifest.json   # Manifest PWA
├── icon-192.png    # Ikon PWA
└── icon-512.png    # Ikon PWA (any maskable)
```

Tiada fail lain. Tiada `package.json`, tiada CI, tiada folder `src/`.

### Susun atur `index.html`

| Baris | Kandungan |
|---|---|
| 1–11 | `<head>`, meta viewport (no-zoom), pautan manifest, Google Fonts |
| 12–~600 | `<style>` — semua CSS, bermula dengan token `:root` |
| ~600–1030 | `<body>` — 17 elemen `<section class="screen">` + bar kemas kini |
| 1034–3581 | IIFE utama (`(function(){ "use strict"; … })();`) — semua logik aplikasi |
| 3584–3626 | IIFE kedua — "Pemeriksa versi" (**lihat §14, ada bug skop**) |

---

## 3. Timbunan teknologi & kekangan mutlak

Kekangan ini bukan cadangan. Melanggarnya akan merosakkan app di peranti sasaran.

1. **JavaScript gaya ES5.** Kod guna `var`, `function(){}`, `Array.prototype.slice.call`. Ada beberapa penggunaan moden terpencil (`Promise`, `fetch`, `AbortController`, `crypto.subtle`, `el.closest`, `NodeList.forEach`, arrow-free). **Jangan** perkenalkan `let`/`const`/arrow function/template literal/`class`/modul ES — konsisten dengan gaya sedia ada dan selamat untuk pelayar Android TV lama.
2. **Satu fail.** Jangan pecahkan `index.html` kepada fail berasingan. Jangan tambah bundler.
3. **Tiada dependency baharu.** Tiada CDN, tiada npm. Semua ikon ialah SVG inline yang ditulis tangan (`IKON`, baris 1913).
4. **Tiada emoji dalam UI.** Emoji diganti sepenuhnya dengan SVG inline supaya paparan konsisten merentas peranti. Guna `ikT("kunci")` atau `data-ik="kunci"`, bukan aksara emoji.
5. **Mesra D-pad.** Setiap elemen interaktif baharu mesti boleh difokus dan boleh dicapai oleh navigasi arah TV (§13).
6. **Offline dahulu.** Semua skrin mesti berfungsi tanpa rangkaian; panggilan rangkaian sentiasa ada laluan gagal yang senyap.

---

## 4. Peta skrin

Skrin ialah `<section class="screen">`; hanya satu ada kelas `.on` pada satu-satu masa. Peralihan **hanya** melalui `show(name)` (baris 1348). Peta objek `screens` di baris 1340.

| Kunci | ID elemen | Fungsi |
|---|---|---|
| `start` | `startScreen` | Menu utama: matlamat harian, 3 butang mod, avatar+level, papan markah, lencana, jadual sifir |
| `tt` | `ttScreen` | Pilih tahap Time Trial (Mudah/Sederhana/Sukar/Hero) |
| `pick` | `pickScreen` | Pilih sifir ×1–×12 untuk mod Latihan |
| `game` | `gameScreen` | Skrin permainan (soalan, pemasa, numpad) |
| `save` | `saveScreen` | Sahkan & hantar markah (Time Trial sahaja, markah > 0) |
| `result` | `resultScreen` | Keputusan: pingat, statistik, kejituan, sifir lemah |
| `lb` | `lbScreen` | Papan markah — tab Time Trial (4 mod) & tab VS |
| `badge` | `badgeScreen` | Grid 40 lencana |
| `ts` | `tsScreen` | Jadual sifir rujukan ×1–×12 |
| `login` | `loginScreen` | Log masuk email + PIN 4 angka |
| `reg` | `regScreen` | Daftar akaun |
| `set` | `setScreen` | Tetapan: bunyi, getaran, nickname, kelas |
| `profile` | `profileScreen` | Profil pemain (sendiri atau pemain lain) |
| `vsHub` | `vsHubScreen` | Senarai perlawanan VS |
| `vsInvite` | `vsInviteScreen` | Cari & jemput lawan |
| `vsBoard` | `vsBoardScreen` | Ranking VS |
| `vsResult` | `vsResultScreen` | Keputusan perlawanan VS |

`show()` juga menguruskan kesan sampingan: sembunyi butang log masuk di luar `start`, segar semula avatar/matlamat harian di `start`, mula/henti polling papan markah, dan buka *watch* Firebase untuk skrin VS.

---

## 5. Peta kod — fungsi utama

### Lapisan rangkaian & backend
| Baris | Fungsi | Peranan |
|---|---|---|
| 1214 | `fetchTimeout(url, opts, ms)` | `fetch` dengan `AbortController` |
| 1225 | `api(payload, cb)` | POST JSON ke Apps Script. **Semua panggilan backend melalui sini.** |
| 1237 | `sendToSheets(rec)` | Pembalut `api` untuk `action:"score"` |
| 1064 | `firebaseUrl(path)` | Bina URL REST Firebase |
| 1067 | `firebaseGet(path)` | GET sekali sahaja |
| 1071 | `firebaseWatch(path, cb)` | `EventSource` (SSE) + auto-cuba-semula |
| 1096 | `sha256Hex(text)` | SHA-256 email → kunci node VS |
| 1102 | `firebaseRefreshLeaderboards()` | Tarik `leaderboards` (nyahlantun) |
| 1119 | `firebaseVsList(raw, prev)` | Normalisasi data VS mentah → `{incoming, active, done}` |
| 1179 | `firebaseApplyVs(raw)` | Sapu data VS ke UI + toast |
| 1202 | `ensureFirebaseVsWatch()` | Buka SSE pada `vsUsers/<sha256(email)>` |

### Enjin permainan
| Baris | Fungsi | Peranan |
|---|---|---|
| 1423 | `startGame(mode)` | Bina objek `state`, mula pemasa |
| 1471 | `tick()` | Kira detik; kendalikan beku |
| 1556 | `rnd(a,b)` | Integer rawak |
| 1558 | `newQuestion()` | Jana soalan (§7) |
| 1603 | `buildEq()` | Render persamaan dengan kotak `?` |
| 1613 | `renderInput()` | Papar input pemain |
| 1691 | `handleKey(k)` | Digit / `clear` / `enter` |
| 1700 | `submit()` | **Teras pemarkahan** — mata, streak, beku, maklum balas |
| 1775 | `nextIfPlaying()` | Soalan seterusnya, atau tamat awal jika VS sudah menang |
| 1799 | `endGame()` | Kemas kini stats, nilai lencana, sync, pilih skrin akhir |
| 1871 | `renderWeak()` | Kira sifir kejituan terendah (min 2 cubaan) |
| 1495 | `startFreeze()` / 1503 `endFreeze()` | Bonus masa beku |
| 1509 | `spawnFlakes(icon)` | Partikel raikan |

### Identiti, stats, kegigihan
| Baris | Fungsi | Peranan |
|---|---|---|
| 2095 | `loadJSON(key, fallback)` | Baca localStorage selamat |
| 2099 | `emptyStats()` | Bentuk stats lalai |
| 2103 | `identitySuffix()` / 2109 `identityKey()` | Namespace localStorage ikut akaun |
| 2115 | `cleanLegacyKeys()` | Migrasi sekali sahaja bagi kunci lama |
| 2116 | `loadIdentityState(guest)` | Tukar antara tetamu ↔ akaun |
| 2139 | `saveMeta()` | Simpan `badgeState` + `stats` |
| 2176 | `syncUp(cb)` | Tolak stats/lencana/avatar ke Sheets |
| 2183 | `requestGameSession(s)` | Dapatkan `sessionToken` sebelum bermain (anti-tipu) |
| 2195 | `resultPayload(s, action)` | Bina muatan penghantaran markah |
| 2212 | `applyAuthoritativeStats(rs)` | Gabung stats pelayan (sentiasa `Math.max`) |
| 2225 | `reconcileVsProgress(src)` | Selaras kemenangan/mata VS → lencana |
| 2241 | `applyRemote(p)` | Gabung penuh profil jauh selepas log masuk |

### Progresi & paparan
| Baris | Fungsi | Peranan |
|---|---|---|
| 2269 | `earn(id)` | Tandakan lencana diperoleh |
| 2277 | `evalBadges()` | Nilai semua syarat lencana |
| 2341 | `evalBadgesRetro(quiet)` | Nilai semula selepas gabungan jauh |
| 2368 | `renderBadges()` | Lukis grid lencana |
| 2065 | `badgeSVG(b, unlocked)` | Jana SVG lencana ikut tier |
| 2524 | `avatarSVG(i)` | Jana SVG avatar (20 avatar) |
| 2533 | `levelOf(xp)` | `min(20, floor(xp/100)+1)` |
| 2536 | `avatarUnlockLevel(i)` | 5 percuma; 15 lagi merata Level 2–20 |
| 2591 | `openProfile(nick, own)` / 2615 `renderProfile(p)` | Skrin profil |
| 1524 | `dailyGoalData()` / 1536 `recordDailyCorrect()` | Matlamat harian 30 betul |

### VS
| Baris | Fungsi | Peranan |
|---|---|---|
| 2708 | `vsRand(seed, n)` | PRNG boleh ulang (mulberry32) |
| 2714 | `vsQuestion(seed, idx)` | Soalan berbenih — **identik untuk kedua-dua pemain** |
| 2721 | `startVS(match)` | Mula perlawanan VS |
| 2750 | `vsFinish()` | Hantar `vs_submit` |
| 2774 | `showVsResult(match, myScore, r)` | Menang / kalah / seri / menunggu |
| 2825 | `openVs()` / 2829 `loadVsHub()` / 2861 `renderVsHub(d)` | Hab VS |
| 2896 | `vsAct(action, id)` | Terima / tolak / mula |
| 2982 | `sendVsInvite(p)` | Hantar jemputan |

### Papan markah
| Baris | Fungsi | Peranan |
|---|---|---|
| 1281 | `loadLB()` / 1289 `saveLB()` / 1298 `addScore()` | Cache papan markah tempatan |
| 3283 | `refreshLB()` | Tarik data dari Firebase/Sheets |
| 3177 | `makeLbPodiumPlayer()` / 3209 `makeLbRow()` | Baris papan markah |
| 3130 | `requestLbAvatar()` / 3145 `hydrateLbAvatars()` | Muat avatar malas (*lazy*) |

### TV / kebolehcapaian
| Baris | Fungsi | Peranan |
|---|---|---|
| 1626 | `visibleTvButtons()` | Elemen boleh fokus dalam skrin aktif |
| 1637 | `moveTvFocus(dir)` | Navigasi arah geometri (`primary + cross*4.5`) |
| 1667+ | Pendengar `keydown` | Anak panah, Enter/OK/Select, digit, Backspace |

---

## 6. Model data

### `state` — sesi permainan semasa (null bila tiada permainan)
```js
{
  mode:"easy|mid|hard|hero|practice|vs",
  practice:false, tables:null|[2,5,9],
  cfg:{min,max,time,label,reverse?},
  score:0, run:0, streak:0, bestStreak:0,
  correct:0, wrong:0, total:0,
  time:60, input:"", current:{a,b,hide,ans}, locked:false,
  freeze:0, freezeCount:0, refilled:false,
  recent:[], tblTry:{}, tblWrong:{},
  roundKey:"<cap masa>-<rawak>", sessionToken:"",
  // hanya VS:
  vs:{id,oppNick,oppAvatar,oppScore,seed}, vsSeed:0, vsTarget:-1, qIndex:0
}
```

### `stats` — kekal, ikut identiti
```js
{ games, totalCorrect, totalWrong, bestStreak, bestScore,
  bestMode:{easy,mid,hard,hero}, modes:{}, vsWins, avatar }
```

### Pemboleh ubah global lain
| Baris | Nama | Isi |
|---|---|---|
| 1275 | `state` | Sesi permainan (atas) |
| 1276 | `setts` | `{sound, vib}` |
| 1288 | `lb` | Cache papan markah tempatan |
| 2102 | `account` | `{email, pass}` atau `null` |
| 2112 | `badgeState` | `{badgeId:true}` |
| 2113 | `stats` | Stats (atas) |
| 2114 | `profile` | `{nickname, kelas}` |
| 3067 | `onlineLB` | Cache papan markah dalam talian |
| 1062 | `vsWaitingResult` | Perlawanan menunggu skor lawan |
| 1523 | `DAILY_GOAL` | `30` |
| 2463 | `AVA_COUNT` | `20` |
| 2531 | `MAX_LEVEL` / `XP_PER_LEVEL` | `20` / `100` |

---

## 7. Enjin permainan

### Mod (baris 1045)
```js
easy:     {min:2, max:5,  time:60,  label:"Mudah"}
mid:      {min:2, max:9,  time:60,  label:"Sederhana"}
hard:     {min:2, max:12, time:60,  label:"Sukar"}
hero:     {min:2, max:12, time:60,  label:"Hero", reverse:true}
practice: {min:2, max:12, time:null, label:"Latihan"}
```

### Penjanaan soalan (`newQuestion`, baris 1558)
- Format: **pengganda × sifir** (cth: sifir 2 → `3 × 2`). `b` ialah *sifir*, `a` hanya pengganda.
- Pengganda biasa `rnd(2,12)`; nombor **1 jarang keluar** (kebarangkalian 1/30).
- Anti-ulang: 10 soalan terakhir disimpan dalam `state.recent`, sehingga 60 percubaan.
- Mod Latihan: hanya sifir dari `state.tables` (pilihan pengguna).
- Mod Hero (`reverse:true`): sembunyikan salah satu **operan**, bukan hasil (`? × 7 = 21`).
- Mod biasa: sembunyikan hasil darab (`hide:"c"`).
- VS: soalan datang dari `vsQuestion(seed, idx)`, bukan rawak — julat menaik `idx<5 → 2–5`, `idx<10 → 2–9`, selebihnya `1–12`.
- Setiap soalan menambah kiraan `state.tblTry[b]`; jawapan salah menambah `state.tblWrong[b]`.

### Pemarkahan (`submit`, baris 1700)
| Peristiwa | Kesan |
|---|---|
| Betul | `mata = 10 + run*2`; `run++`; had markah 9,999,999 |
| 3 betul berturut | `streak++` |
| Streak (mod masa) | `+3 saat` |
| Setiap 3 streak | **Beku masa 5 saat** |
| Setiap 3 kali beku | **Masa penuh semula** (`state.refilled = true`) |
| Salah | `run = 0`, `streak = 0`, papar jawapan betul 1,250 ms |
| Betul | Teruskan selepas 420 ms |

Mod Latihan tidak dapat beku/masa tambahan — hanya paparan "STREAK ×n".

### Tamat permainan (`endGame`, baris 1799)
1. Kemas kini `stats`, `saveMeta()`, `evalBadges()`, `syncUp()`.
2. VS → `vsFinish()` (keluar awal).
3. Latihan → `submitPracticeProgress()` → skrin `result`.
4. Time Trial dengan markah > 0 → skrin `save`; jika tidak → `result`.
5. Ambang pingat: `<60` benih · `<140` bintang · `<240` emas · selebihnya mahkota.

---

## 8. Progresi

| Sistem | Peraturan |
|---|---|
| XP | XP = `stats.totalCorrect` (jumlah jawapan betul terkumpul) |
| Level | `min(20, floor(XP/100)+1)` — maksimum Level 20 |
| Avatar | 20 avatar (5 monster prosedur + 15 watak "WOW"). 5 percuma; 15 lagi buka merata Level 2–20 |
| Lencana | **40 lencana**, 5 tier (`BTIER`, baris 2057). Kategori: sesi dimainkan, jumlah betul, streak, markah tertinggi, ketepatan, mod dicuba, level, mata/kemenangan VS, matlamat harian |
| Matlamat harian | 30 jawapan betul sehari; disimpan di `sifirJuaraDailyGoal`, ditetapkan semula ikut tarikh tempatan (`en-CA`) |

---

## 9. Mod VS (asinkroni, bukan masa nyata)

Kedua-dua pemain menjawab **set soalan yang sama** melalui benih (*seed*) yang dikongsi. Mereka tidak bermain serentak.

```
A jemput B                 → api vs_invite
B terima                   → api vs_accept        (melalui vsAct)
Pemain pertama bermain     → markah jadi sasaran
Pemain kedua bermain       → nampak "Kalahkan N markah"
                             menang serta-merta bila markah > sasaran (nextIfPlaying)
Kedua-dua selesai          → pelayan pulangkan result: win|lose|draw
```

- Sasaran langsung dipaparkan dalam `#vsTargetBar`.
- Bila lawan belum bermain, skrin keputusan masuk keadaan **menunggu** dan `firebaseWatch` pada `vsUsers/<hash>` akan menyelesaikannya secara langsung.
- Kemenangan & mata VS **sentiasa** dari pelayan (`reconcileVsProgress`), tidak pernah dikira di klien.
- Lencana VS: 1 / 50 / 150 / 350 / 700 mata; 1 & 10 kemenangan.

---

## 10. Kontrak backend

### 10.1 Google Apps Script Web App (sumber kebenaran)

```
POST https://script.google.com/macros/s/AKfycbwVIiBDzbK61Tcr_A6Krx2EFmn74uNYYKCbNq_nNiMPW96eC-6ZqdHx9ViIIL0EMz9CKg/exec
Content-Type: text/plain      (elak preflight CORS)
Body: JSON.stringify(payload) — payload.action menentukan operasi
Respons: JSON, sentiasa mengandungi { ok: true|false, err?: "..." }
```

| `action` | Muatan | Respons |
|---|---|---|
| `register` | `email, pass, nickname, kelas` | `{ok}` |
| `login` | `email, pass` | `{ok, nickname, kelas, stats, badges, highs}` |
| `reset` | `email` | `{ok}` — hantar PIN ke email |
| `sync` | `email, pass, nickname, kelas, avatar, badges, stats` | `{ok}` |
| `game_start` | `email, pass, nama, mod, matchId` | `{ok, sessionToken}` |
| `game_end` | muatan keputusan + `sessionToken` | `{ok, stats, isBest, first, best}` |
| `score` | muatan keputusan (fallback tanpa token) | `{ok, isBest, first, best}` |
| `profile` | `nickname` | `{ok, …data profil}` |
| `vs_players` | `email, pass` | `{ok, players:[…]}` |
| `vs_invite` | `email, pass, oppNick` | `{ok}` |
| `vs_list` | `email, pass` | `{ok, incoming, active, done}` |
| `vs_accept` / `vs_reject` / `vs_start` | `email, pass, matchId` | `{ok}` |
| `vs_submit` | muatan keputusan + `matchId` | `{ok, done, oppScore, result, mata, menang}` |
| `vs_board` | — | `{ok, board:[…]}` |

**Muatan keputusan** (`resultPayload`, baris 2195):
```js
{ action, sessionToken, email, pass,
  nama:"HURUF BESAR", kelas:"HURUF BESAR", mod:"Mudah|…|VS",
  avatar:0..19, markah, betul, salah, streak }
```

Tamat masa: 22,000 ms untuk `vs_submit`, 12,000 ms untuk yang lain.

### 10.2 Firebase Realtime Database (baca sahaja, mempercepat sahaja)

```
https://sifir-juara-default-rtdb.asia-southeast1.firebasedatabase.app
```

| Laluan | Isi | Cara akses |
|---|---|---|
| `leaderboards` | `{easy, mid, hard, hero, vs}` | `firebaseGet` + SSE |
| `vsUsers/<sha256(email huruf kecil)>` | Keadaan VS pemain | `firebaseGet` + SSE |

Firebase **tidak pernah** menjadi sumber kebenaran. Sheets kekal berautoriti; Firebase hanya menjadikan ranking dan VS kelihatan serta-merta.

### 10.3 Kunci localStorage

| Kunci | Skop | Isi |
|---|---|---|
| `sifirJuaraAcc` | global | `{email, pass}` |
| `sifirJuaraSet` | global | `{sound, vib}` |
| `sifirJuaraLB` | global | Cache papan markah tempatan |
| `sifirJuaraGuest` | global | Nombor tetamu yang dijana |
| `sifirJuaraDailyGoal` | global | `{date, correct, celebrated}` |
| `sifirJuaraVsPlayers` | global | Cache senarai pemain |
| `sifirJuaraStats<suffix>` | ikut identiti | Objek stats |
| `sifirJuaraBadges<suffix>` | ikut identiti | `{badgeId:true}` |
| `sifirJuaraProfile<suffix>` | ikut identiti | `{nickname, kelas}` |
| `sjCleaned1` | global | Bendera migrasi sekali |

`<suffix>` datang dari `identitySuffix()` (baris 2103) — kosong untuk tetamu, terikat email bila log masuk. Ini membolehkan berbilang murid berkongsi satu peranti.

---

## 11. PWA & kemas kini

Terdapat **dua** mekanisme kemas kini bebas:

1. **Melalui service worker** (baris 1243–1268, dalam IIFE utama) — daftar `sw.js?v=<APP_VERSION>`, panggil `reg.update()` semasa buka, selepas 3 saat, setiap 15 minit, pada `visibilitychange` dan pada `online`. Pendengar `controllerchange` melakukan satu `location.reload()`.
2. **Pemeriksa versi dalam halaman** (baris 3584–3626) — `fetch` `index.html` mentah, cari `APP_VERSION`, papar `#updBar`, nyahdaftar SW + kosongkan cache + muat semula keras. **Kod ini kini tidak berfungsi — lihat §14, Isu 1.**

`sw.js` menggunakan:
- **navigate** → rangkaian dahulu, cache sebagai sandaran
- **aset lain** → cache dahulu, rangkaian jika tiada
- **`script.google` / `firebasedatabase.app`** → tidak pernah dicache, sentiasa rangkaian
- **bukan GET** → dilepaskan terus ke rangkaian

---

## 12. Reka bentuk visual

Token warna dalam `:root` (baris ~13):

| Token | Nilai | Guna |
|---|---|---|
| `--bg1` / `--bg2` | `#1b1650` / `#2a1a5e` | Latar malam indigo |
| `--card` | `#fef9ff` | Kad putih lembut |
| `--ink` | `#241a52` | Teks atas kad |
| `--cyan` | `#25d9e8` | Tindakan utama |
| `--magenta` | `#ff3d97` | Kotak `?`, aksen |
| `--yellow` | `#ffcf3f` | Streak, syiling, fokus TV |
| `--lime` | `#48e08a` | Betul |
| `--red` | `#ff5a6e` | Salah, masa hampir habis |
| `--muted` | `#9b93c9` | Teks sekunder |

Font: **Fredoka** (nombor & tajuk), **Nunito** (teks). Lebar pentas maksimum 440px, berpusat.

52 ikon SVG inline dalam objek `IKON` (baris 1913), digunakan melalui `data-ik="nama"` atau `ikT("nama")`.

---

## 13. Sokongan TV / D-pad

Pengesanan TV (baris 1038–1043) melalui tiga isyarat: rentetan user-agent, heuristik Android-bukan-mudah-alih, atau `?tv=1` dalam URL. Menambah kelas `tvDevice` pada `<html>`.

- Navigasi arah menggunakan **jarak geometri**, bukan susunan DOM: `skor = utama + silang * 4.5` (mengutamakan baris/lajur yang sama).
- Hanya elemen dalam **skrin aktif** boleh difokus (`visibleTvButtons` menapis melalui `el.closest(".screen")`).
- Fokus kelihatan jelas: `outline: 4px solid var(--yellow)`.
- Kekunci Enter/OK/Select mengklik butang yang difokus.
- Semasa permainan, digit 0–9 (baris atas dan numpad) serta Backspace/Delete diterima terus.

**Bila menambah UI baharu:** letakkannya dalam sesuatu `<section class="screen">` dan pastikan ia `<button>` atau `<input>` sebenar, bukan `<div>` yang boleh diklik.

---

## 14. Isu & risiko yang diketahui

### Isu 1 — Pemeriksa versi ialah kod mati (BUG SEBENAR) 🔴
IIFE utama ditutup di **baris 3581**. Pemeriksa versi bermula di **baris 3584**, di luar skop itu, tetapi merujuk `$` (ditakrif `var` di baris 1339), `APP_VERSION` (baris 1037) dan `curScreen` (baris 1346) — kesemuanya tersembunyi dalam IIFE utama.

Baris 3621, `var btn=$("updBtn");`, dijalankan serta-merta dan membaling `ReferenceError: $ is not defined`. Ini **membatalkan seluruh IIFE kedua** sebelum `setTimeout(check, 1200)` sempat didaftarkan. Kesannya: bar "Versi baharu tersedia" tidak pernah muncul, dan laluan muat-semula-keras tidak pernah berjalan.

Kemas kini masih sampai melalui laluan service worker (§11 mekanisme 1), jadi bug ini tersembunyi — tetapi sandaran hilang.

**Disahkan**: memuatkan `index.html` dalam Chromium tanpa kepala menghasilkan `PAGEERROR: $ is not defined` sebaik sahaja halaman dimuatkan.

**Pembetulan:** dedahkan yang diperlukan pada `window` di hujung IIFE utama (`window.SJ = {$:$, APP_VERSION:APP_VERSION, getScreen:function(){return curScreen;}};`), atau alihkan blok pemeriksa versi ke dalam IIFE utama. Jangan sekadar `try/catch` — itu menyembunyikan masalah.

### Isu 2 — PIN disimpan dan dihantar sebagai teks biasa 🟠
`account = {email, pass}` disimpan tidak berenkripsi dalam localStorage, dan PIN 4 angka dihantar dalam setiap muatan `api()`. Untuk permainan sifir sekolah rendah risikonya rendah dan reka bentuknya disengajakan (murid perlu boleh log masuk semula dengan mudah), tetapi:
- Jangan sekali-kali guna semula PIN ini untuk apa-apa yang bernilai lebih tinggi.
- Ruang kunci ialah 10,000 sahaja — pelayan mesti mengehadkan kadar `login` dan `reset`.

### Isu 3 — Firebase boleh dibaca umum 🟠
URL RTDB dibenamkan dalam klien dan dibaca melalui REST tanpa autentikasi. Sesiapa boleh membaca `leaderboards` dan, jika mereka tahu SHA-256 email seseorang, node `vsUsers` orang itu. Pastikan peraturan keselamatan RTDB ialah `.read: true, .write: false` supaya klien tidak boleh menulis.

### Isu 4 — Ketidakpadanan dokumentasi julat sifir 🟡
UI menyatakan "Sifir ×1 hingga ×5 / ×9 / ×12", tetapi `MODES` menetapkan `min:2`. Sifir 1 hanya muncul melalui laluan khas 1/30 dalam `newQuestion`. Teks dan kod bercanggah — betulkan salah satu, bukan kedua-duanya secara berasingan.

### Isu 5 — Versi berkod keras di dua tempat 🟡
Nilai lalai `#verLine` ialah `"Sifir × Juara v4.4"` (baris 768) tetapi `APP_VERSION` ialah `"5.3"`. Runtime menimpanya di baris 3514, jadi pengguna tidak nampak — namun ia mengelirukan sesiapa yang membaca kod. Cache `sw.js` (`sifir-juara-v70`) juga bergerak bebas daripada `APP_VERSION`.

### Isu 6 — Fail 213 KB / 3,629 baris 🟡
Alat penyuntingan automatik mudah membaca fail ini secara separa dan menulis semula versi terpotong. **Sentiasa sunting melalui operasi setempat** (`sed -i`, ganti-rentetan, tampalan) — jangan sekali-kali menjana semula keseluruhan `index.html` daripada ingatan.

### Isu 7 — Tiada ujian, tiada linting 🟡
Tiada apa-apa yang menangkap regresi. Selepas apa-apa perubahan, uji manual: satu permainan setiap mod, log masuk, satu perlawanan VS, mod luar talian, dan navigasi D-pad.

---

## 15. Peraturan untuk AI yang menyunting repo ini

### Sebelum menyunting
1. Baca bahagian `index.html` yang berkaitan — jangan andaikan struktur.
2. Kenal pasti skrin dan fungsi yang terjejas menggunakan peta di §4 dan §5.

### Semasa menyunting
3. **Padankan gaya sedia ada**: `var`, `function(){}`, tanpa arrow, tanpa template literal.
4. **Tiada dependency baharu.** Tiada CDN, tiada npm, tiada fail baharu untuk kod.
5. **Bahasa Melayu** untuk semua teks UI, komen dan mesej commit.
6. **Tiada emoji** — tambah ikon SVG ke `IKON` dan guna `ikT()` / `data-ik`.
7. **Guna suntingan setempat.** Jangan tulis semula keseluruhan fail (lihat Isu 6).
8. Elemen UI baharu mesti `<button>`/`<input>` sebenar di dalam `<section class="screen">` (lihat §13).
9. Panggilan rangkaian baharu mesti melalui `api()` atau `firebaseGet()` dan mesti gagal secara senyap ke keadaan luar talian.
10. Jangan kira mata/kemenangan VS di klien — terima daripada pelayan.

### Selepas menyunting — senarai semak lepas landas
11. **Naikkan `APP_VERSION`** di baris 1037 (cth. `"5.3"` → `"5.4"`).
12. **Naikkan `CACHE`** dalam `sw.js` baris 2 (cth. `sifir-juara-v70` → `v71`). Jika terlupa, pengguna sedia ada akan tersekat pada versi lama.
13. Kemas kini `#verLine` lalai di baris 768 jika ia disunting.
14. Jika aset baharu ditambah, tambahkannya ke tatasusunan `ASSETS` dalam `sw.js`.
15. Uji manual: setiap mod, log masuk, VS, luar talian, D-pad.
16. Deploy = commit ke `main`; GitHub Pages menyampaikannya.

### Jangan sekali-kali
- Jangan ubah `SHEETS_URL` atau `FIREBASE_DB_URL` tanpa arahan jelas — ia menunjuk ke data murid sebenar.
- Jangan tukar bentuk `resultPayload` tanpa mengemas kini Apps Script serentak.
- Jangan alih keluar namespace `identityKey()` — ia yang membolehkan berbilang murid berkongsi satu peranti.
- Jangan tambah `localStorage` untuk apa-apa yang mesti kekal merentas peranti; gunakan `syncUp()`.

---

## 16. Glosari

| Bahasa Melayu | English |
|---|---|
| sifir | multiplication table |
| markah | score |
| betul / salah | correct / wrong |
| streak | streak (3 betul berturut = 1 streak) |
| beku | freeze (pemasa dihentikan) |
| lencana | badge |
| papan markah | leaderboard |
| lawan (VS) | opponent / versus match |
| jemputan | invitation |
| tetamu | guest |
| kelas | class (cth. "3 Bijak") |
| aras | level |
| kejituan | accuracy |
| matlamat harian | daily goal |
| tetapan | settings |
| kemas kini | update |
| luar talian | offline |

---

*Blueprint ini menerangkan `index.html` v5.3 (3,629 baris), `sw.js` cache `v70`. Jika nombor baris tidak lagi sepadan, kod telah berubah — sahkan sebelum bergantung padanya.*
