# Patch Apps Script — Papan Markah Bulanan

Untuk `Code.gs` projek **SifirXJuara**. Ganti fungsi yang disenaraikan, satu demi satu.
Semua nama fungsi kekal sama, jadi tiada bahagian lain perlu disentuh.

**Auto sepenuhnya**: kunci bulan dikira daripada `new Date()` setiap kali dipanggil.
Pada tengah malam 1 September, papan markah bertukar ke September dengan sendirinya —
tiada trigger, tiada cron, tiada butang reset, tiada apa yang boleh terlupa dijalankan.

---

## 1. Ganti baris `var C = {...}`

```js
var C = { MASA:0, NAMA:1, KELAS:2, MODE:3, MARKAH:4, BETUL:5, SALAH:6, STREAK:7, EMAIL:8, BULAN:9 };
```

## 2. Tampal blok baharu ini betul-betul selepas `var BULAN = [...]`

```js
var BULAN_PENUH = ["Januari","Februari","Mac","April","Mei","Jun",
  "Julai","Ogos","September","Oktober","November","Disember"];
var TZ = "Asia/Singapore";     // sama zon waktu dengan Malaysia (UTC+8)
var SIMPAN_BULAN = 13;         // bulan ini + 12 bulan lalu disimpan untuk profil

function bulanKini_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM");
}

// Bulan bagi satu baris. Kalau lajur Bulan masih kosong (baris lama), ia dikira
// daripada lajur Masa — jadi TIADA migrasi manual diperlukan.
function bulanOf_(row) {
  var b = String(row[C.BULAN] == null ? "" : row[C.BULAN]).trim();
  if (/^\d{4}-\d{2}$/.test(b)) return b;
  var m = row[C.MASA];
  var dt = (m instanceof Date) ? m : new Date(Date.parse(m));
  if (!dt || isNaN(dt.getTime())) return "";
  return Utilities.formatDate(dt, TZ, "yyyy-MM");
}

function bulanTolak_(b, n) {
  var y = Number(b.slice(0, 4)), m = Number(b.slice(5, 7));
  var t = y * 12 + (m - 1) - n;
  var yy = Math.floor(t / 12), mm = (t % 12) + 1;
  return yy + "-" + (mm < 10 ? "0" : "") + mm;
}

function labelBulan_(b) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(b || ""));
  return m ? (BULAN_PENUH[Number(m[2]) - 1] + " " + m[1]) : String(b || "");
}

// Kunci cache mengandungi bulan, jadi papan markah lama tidak boleh tersangkut
// selama 30 saat selepas bulan bertukar.
function kunciCacheLb_() { return "leaderboard-" + bulanKini_(); }

// Papan markah untuk satu bulan. Dikongsi oleh doGet dan penyegerakan Firebase
// (dahulu kod ini disalin dua kali — mudah terpesong).
function papanMarkahBulan_(bulan) {
  var sh = markahSheet();
  var out = { easy:[], mid:[], hard:[], hero:[] };
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var key = MODE_MAP[rows[i][C.MODE]];
    if (!key) continue;
    if (bulanOf_(rows[i]) !== bulan) continue;
    out[key].push({
      n:up(rows[i][C.NAMA]), k:up(rows[i][C.KELAS]),
      s:scoreOf(rows[i]), d:fmtDate(rows[i][C.MASA])
    });
  }
  for (var m in out) out[m].sort(function(a, b){ return b.s - a.s; });
  out.bulan = bulan;
  out.bulanLabel = labelBulan_(bulan);
  out.updatedAt = Date.now();
  return out;
}
```

## 3. Ganti `markahSheet`

```js
function markahSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Markah");
  if (!sh) {
    sh = ss.insertSheet("Markah");
    sh.appendRow(["Masa","Nama","Kelas","Mode","Markah","Betul","Salah","Streak Terbaik","Email","Bulan"]);
  }
  if (sh.getLastColumn() < 9 || String(sh.getRange(1, 9).getValue()) !== "Email") {
    sh.getRange(1, 9).setValue("Email");
  }
  if (sh.getLastColumn() < 10 || String(sh.getRange(1, 10).getValue()) !== "Bulan") {
    sh.getRange(1, 10).setValue("Bulan");
  }
  return sh;
}
```

## 4. Ganti `firebaseScoreBoardData_`

```js
function firebaseScoreBoardData_() {
  return papanMarkahBulan_(bulanKini_());
}
```

## 5. Ganti `addScoreRow`

```js
function addScoreRow(d) {
  var checked = validateGameResult(d);
  if (!checked.ok) return checked;
  var email = String(checked.session.email || "");
  var mode = String(checked.session.mode || "");
  var nama = up(checked.session.nama);
  var kelas = up(d.kelas);
  var score = checked.score, betul = checked.betul, salah = checked.salah, streak = checked.streak;
  var auth = accountGameStats(email, mode, score, betul, salah, streak);

  if (mode === "Latihan" || mode === "VS") {
    useGameSession(checked.session);
    return { ok:true, saved:false, practice:(mode === "Latihan"),
      stats:auth ? auth.stats : null, badges:auth ? auth.badges : null };
  }

  var sh = markahSheet();
  var bkini = bulanKini_();
  var myId = identity(email, nama, kelas);
  var rows = sh.getDataRange().getValues();
  var bestRow = -1, existingBest = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][C.MODE]) !== mode) continue;
    if (bulanOf_(rows[i]) !== bkini) continue;          // <-- hanya bandingkan dalam bulan ini
    if (identity(emailOf(rows[i]), rows[i][C.NAMA], rows[i][C.KELAS]) === myId) {
      var sc = scoreOf(rows[i]);
      if (sc > existingBest) { existingBest = sc; bestRow = i + 1; }
    }
  }

  var first = existingBest < 0;
  var isBest = score > existingBest;
  var newRow = [new Date(), nama, kelas, mode, score, betul, salah, streak, email, bkini];
  if (first) sh.appendRow(newRow);
  else if (isBest) sh.getRange(bestRow, 1, 1, 10).setValues([newRow]);

  useGameSession(checked.session);
  CacheService.getScriptCache().remove(kunciCacheLb_());
  maybePurge(sh);
  return { ok:true, saved:(first || isBest), best:Math.max(existingBest, score),
    isBest:isBest, first:first, stats:auth ? auth.stats : null, badges:auth ? auth.badges : null };
}
```

## 6. Ganti `purge`

```js
// Kekalkan hanya SATU baris tertinggi setiap (identiti, mod, BULAN).
// Berdaftar: SIMPAN_BULAN bulan terakhir. Guest: bulan ini sahaja dan < 24 jam.
function purge(sh) {
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return;
  var header = data[0];
  var lebar = Math.max(header.length, 10);
  var now = Date.now();
  var bkini = bulanKini_();
  var hadBulan = bulanTolak_(bkini, SIMPAN_BULAN - 1);

  var bestRow = {}, takTentu = [], perluTulis = false;
  for (var i = 1; i < data.length; i++) {
    var b = bulanOf_(data[i]);
    if (!b) { takTentu.push(data[i]); continue; }   // bulan tak terbaca: JANGAN buang
    if (String(data[i][C.BULAN]).trim() !== b) { data[i][C.BULAN] = b; perluTulis = true; }
    var id = identity(emailOf(data[i]), data[i][C.NAMA], data[i][C.KELAS])
      + "|" + String(data[i][C.MODE]) + "|" + b;
    if (!bestRow[id] || scoreOf(data[i]) > scoreOf(bestRow[id])) bestRow[id] = data[i];
  }

  var kept = [header];
  for (var k in bestRow) {
    var row = bestRow[k], b2 = String(row[C.BULAN]);
    if (emailOf(row)) {
      if (b2 >= hadBulan) kept.push(row);                        // berdaftar
    } else if (b2 === bkini && (now - timeOf(row)) <= GUEST_MS) {
      kept.push(row);                                             // guest
    }
  }
  for (var t = 0; t < takTentu.length; t++) kept.push(takTentu[t]);

  if (kept.length !== data.length || perluTulis) {
    for (var q = 0; q < kept.length; q++) {
      while (kept[q].length < lebar) kept[q].push("");
    }
    sh.getRange(1, 1, sh.getLastRow(), lebar).clearContent();
    sh.getRange(1, 1, kept.length, lebar).setValues(kept);
  }
}
```

## 7. Dalam `getProfile`, ganti blok pengiraan `highs`

Cari blok yang bermula `var highs = { easy:0, ... }` dan berakhir sebelum `return {`.
Gantikan dengan:

```js
  var bkini = bulanKini_();
  var highs = { easy:0, mid:0, hard:0, hero:0 };      // bulan ini
  var highsAll = { easy:0, mid:0, hard:0, hero:0 };   // semua bulan yang masih disimpan
  var bulanan = {};                                    // "2026-07": {easy:.., mid:.., ..}
  var maxStreak = 0;
  var msh = markahSheet();
  var mrows = msh.getDataRange().getValues();
  for (var j = 1; j < mrows.length; j++) {
    var e = emailOf(mrows[j]), nm = up(mrows[j][C.NAMA]);
    if ((email && e === email) || nm === nick) {
      var key = MODE_MAP[mrows[j][C.MODE]];
      if (key) {
        var sc = scoreOf(mrows[j]), b = bulanOf_(mrows[j]);
        if (sc > highsAll[key]) highsAll[key] = sc;
        if (b === bkini && sc > highs[key]) highs[key] = sc;
        if (b) {
          if (!bulanan[b]) bulanan[b] = { easy:0, mid:0, hard:0, hero:0 };
          if (sc > bulanan[b][key]) bulanan[b][key] = sc;
        }
      }
      maxStreak = Math.max(maxStreak, Number(mrows[j][C.STREAK]) || 0);
    }
  }
```

Kemudian dalam `return { ... }` fungsi itu, tukar baris terakhir `highs: highs` kepada:

```js
    highs: highs,
    highsAll: highsAll,
    bulanan: bulanan,
    bulan: bkini
```

## 8. Ganti `doGet`

```js
function doGet(e) {
  var cache = CacheService.getScriptCache();
  var kunci = kunciCacheLb_();
  var cached = cache.get(kunci);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  var json = JSON.stringify(papanMarkahBulan_(bulanKini_()));
  cache.put(kunci, json, 30);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
```

## 9. Dalam `syncAcc`, tukar kunci cache

Cari:

```js
    CacheService.getScriptCache().remove("leaderboard-v1");
```

Tukar kepada:

```js
    CacheService.getScriptCache().remove(kunciCacheLb_());
```

---

## Deploy

1. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**
   (Simpan sahaja tidak cukup — Web App kekal pada versi lama sehingga anda buat versi baharu.)
2. **Pilih fungsi `firebaseSeedAll` dalam editor dan tekan Run — SEKALI.**
   Ini WAJIB. Lihat penjelasan di bawah.
3. Selepas itu tiada apa perlu dijalankan lagi. Lajur `Bulan` mengisi sendiri pada
   `purge` pertama; sebelum itu bulan dibaca daripada lajur `Masa`.

### Kenapa langkah 2 wajib

Ada DUA sumber papan markah, dan keduanya berkelakuan berbeza:

| Sumber | Cara ia dikemas kini |
|---|---|
| `doGet` (Sheets) | Dikira **semasa dibaca** — terus betul sebaik deploy |
| `leaderboards/score` (Firebase) | Salinan yang **ditolak** oleh `firebaseSyncLeaderboards_()` |

Firebase hanya ditolak semula apabila ada orang menyimpan markah, mendaftar, atau `sync`.
Sebelum itu ia masih memegang papan markah LAMA — termasuk rekod bulan lepas — dan klien
membaca Firebase dahulu kerana ia lebih pantas. Jadi selepas deploy, papan markah masih
menunjukkan bulan lepas sehingga sesuatu mencetuskan penyegerakan.

`firebaseSeedAll` menolak semula papan markah menggunakan kod baharu, jadi Firebase terus
selaras. Ia selamat dijalankan bila-bila masa dan boleh diulang.

## Apa yang berlaku sebaik selepas deploy

| Keadaan pemain | Kesan |
|---|---|
| Markah tertinggi dicatat bulan **Ogos** | Kekal di papan markah dengan ranking yang sama |
| Markah tertinggi dicatat bulan **sebelum Ogos** | Hilang dari papan markah; masih nampak dalam profil |
| Main baharu dalam Ogos | Baris Ogos baharu dicipta, baris bulan lama tidak disentuh |
| 1 September, 12:00 pagi | Papan markah kosong dan mula semula dengan sendirinya |

## Satu had yang perlu diketahui

Sejarah bulanan **bermula dari sekarang**. Sistem lama hanya menyimpan satu baris
tertinggi sepanjang masa bagi setiap pemain, jadi markah bulan-bulan lalu memang
sudah tiada dalam helaian — ia tidak boleh dibina semula. Selepas patch ini
dipasang, setiap bulan baharu akan terkumpul dengan sendirinya.
