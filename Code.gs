/**
 * Sifir Juara — Google Apps Script (v7: papan markah bulanan)
 *
 * MODEL:
 *  - Setiap markah masuk -> statistik dikumpul (Akaun, oleh aplikasi) + kedudukan dikira.
 *  - Rekod BUKAN tertinggi (guest & berdaftar) tidak disimpan (dibuang selepas diambil).
 *  - Rekod GUEST tertinggi disimpan, dipadam selepas 24 jam.
 *  - Rekod BERDAFTAR tertinggi kekal 13 bulan (bulan ini + 12 bulan lalu).
 *  => Tab "Markah" ada SATU baris tertinggi setiap (pengguna, mod, BULAN).
 *
 * PAPAN MARKAH BULANAN (baharu):
 *  - Papan markah Time Trial hanya memaparkan BULAN SEMASA.
 *  - Kunci bulan dikira daripada new Date() setiap kali dipanggil, jadi peralihan
 *    bulan berlaku dengan sendirinya pada tengah malam 1 haribulan.
 *    Tiada trigger, tiada cron, tiada butang reset.
 *  - Markah bulan lalu masih boleh dilihat dalam profil (medan "bulanan").
 *
 * Sheet "Markah": Masa | Nama | Kelas | Mode | Markah | Betul | Salah | Streak | Email | Bulan
 * Sheet "Akaun":  Email | PIN | Nickname | Kelas | Lencana | Statistik | Didaftar
 *
 * SELEPAS TAMPAL: (1) Ctrl+S untuk simpan.
 *                 (2) Deploy > Manage deployments > (pensel) > New version > Deploy.
 *                 (3) Run 'firebaseSeedAll' SEKALI supaya salinan Firebase diselaraskan.
 */

var C = { MASA:0, NAMA:1, KELAS:2, MODE:3, MARKAH:4, BETUL:5, SALAH:6, STREAK:7, EMAIL:8, BULAN:9 };
var GUEST_MS = 24 * 60 * 60 * 1000;
var MODE_MAP = { "Mudah":"easy", "Sederhana":"mid", "Sukar":"hard", "Hero":"hero" };
var BULAN = ["Jan","Feb","Mac","Apr","Mei","Jun","Jul","Ogo","Sep","Okt","Nov","Dis"];

/* ---------- BULANAN ---------- */
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

// Kunci cache mengandungi bulan, supaya papan markah bulan lepas tidak boleh
// tersangkut dalam cache selepas bulan bertukar.
function kunciCacheLb_() { return "leaderboard-" + bulanKini_(); }

// Papan markah untuk satu bulan. Dikongsi oleh doGet dan penyegerakan Firebase.
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

var GAME_MODES = { "Mudah":true, "Sederhana":true, "Sukar":true, "Hero":true, "Latihan":true, "VS":true };
var GAME_SESSION_MAX_MS = 2 * 60 * 60 * 1000;

function gameSecret() {
  var p = PropertiesService.getScriptProperties();
  var secret = p.getProperty("gameSecret");
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    p.setProperty("gameSecret", secret);
  }
  return secret;
}

function signGamePayload(payload) {
  var body = Utilities.base64EncodeWebSafe(payload, Utilities.Charset.UTF_8).replace(/=+$/,"");
  var sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(body, gameSecret())
  ).replace(/=+$/,"");
  return body + "." + sig;
}

function decodeGameToken(token) {
  var parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  var expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(parts[0], gameSecret())
  ).replace(/=+$/,"");
  if (expected !== parts[1]) return null;
  try {
    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function startGameSession(d) {
  var mode = String(d.mod || "");
  if (!GAME_MODES[mode]) return { ok:false, err:"Mod permainan tidak sah" };
  var email = String(d.email || "").trim().toLowerCase();
  var nama = up(d.nama);
  var matchId = String(d.matchId || "");
  if (email) {
    var a = authVS(d);
    if (!a) return { ok:false, err:"Sesi akaun tidak sah" };
    nama = up(a.sh.getRange(a.r, 3).getValue());
  } else if (!nama) {
    return { ok:false, err:"Nama pemain diperlukan" };
  }
  if (mode === "VS") {
    if (!email || !matchId) return { ok:false, err:"Perlawanan VS tidak sah" };
    var vs = sheetVS();
    var vr = vsFindRow(vs, matchId);
    if (vr < 0) return { ok:false, err:"Perlawanan tidak dijumpai" };
    var row = vs.getRange(vr, 1, 1, 14).getValues()[0];
    var ce = String(row[V.CE]).trim().toLowerCase();
    var oe = String(row[V.OE]).trim().toLowerCase();
    if (row[V.STATUS] !== "accepted" || (email !== ce && email !== oe)) {
      return { ok:false, err:"Perlawanan VS tidak aktif" };
    }
    if ((email === ce && vScore(row[V.CS]) >= 0) || (email === oe && vScore(row[V.OS]) >= 0)) {
      return { ok:false, err:"Anda sudah main" };
    }
  }
  var payload = JSON.stringify({
    v:1, nonce:Utilities.getUuid(), email:email, nama:nama,
    mode:mode, matchId:matchId, started:Date.now()
  });
  return { ok:true, sessionToken:signGamePayload(payload) };
}

function verifyGameSession(d) {
  var s = decodeGameToken(d.sessionToken);
  if (!s || s.v !== 1 || !s.nonce) return { ok:false, err:"Sesi permainan tidak sah" };
  var age = Date.now() - Number(s.started || 0);
  if (age < 0 || age > GAME_SESSION_MAX_MS) return { ok:false, err:"Sesi permainan telah tamat" };
  if (CacheService.getScriptCache().get("game-used-" + s.nonce)) {
    return { ok:false, err:"Keputusan permainan sudah dihantar" };
  }
  var email = String(d.email || "").trim().toLowerCase();
  if (email !== String(s.email || "") || up(d.nama) !== up(s.nama) ||
      String(d.mod || "") !== String(s.mode || "") ||
      String(d.matchId || "") !== String(s.matchId || "")) {
    return { ok:false, err:"Butiran keputusan tidak sepadan" };
  }
  if (email && !authVS(d)) return { ok:false, err:"Sesi akaun tidak sah" };
  if (s.mode !== "Latihan" && s.mode !== "VS" && age < 40000) {
    return { ok:false, err:"Permainan tamat terlalu awal" };
  }
  s.age = age;
  return { ok:true, session:s };
}

function validateGameResult(d) {
  var checked = verifyGameSession(d);
  if (!checked.ok) return checked;
  var score = Number(d.markah), betul = Number(d.betul), salah = Number(d.salah), streak = Number(d.streak);
  var vals = [score, betul, salah, streak];
  for (var i = 0; i < vals.length; i++) {
    if (!isFinite(vals[i]) || vals[i] < 0 || Math.floor(vals[i]) !== vals[i]) {
      return { ok:false, err:"Keputusan permainan tidak sah" };
    }
  }
  var total = betul + salah;
  if (total > 5000 || total > Math.floor(checked.session.age / 120) + 3) {
    return { ok:false, err:"Kadar jawapan tidak munasabah" };
  }
  if (score < betul * 10 || score > betul * (betul + 9) || streak > Math.floor(betul / 3)) {
    return { ok:false, err:"Markah permainan tidak sepadan" };
  }
  checked.score = score; checked.betul = betul; checked.salah = salah; checked.streak = streak;
  return checked;
}

function useGameSession(s) {
  CacheService.getScriptCache().put("game-used-" + s.nonce, "1", 21600);
}


function up(v){ return String(v == null ? "" : v).trim().toUpperCase(); }
function emailOf(row){ return row[C.EMAIL] ? String(row[C.EMAIL]).trim().toLowerCase() : ""; }
function scoreOf(row){ return Number(row[C.MARKAH]) || 0; }
function timeOf(row){ var m = row[C.MASA]; return (m instanceof Date) ? m.getTime() : (Date.parse(m) || 0); }
function fmtDate(m){
  return (m instanceof Date)
    ? m.getDate() + " " + BULAN[m.getMonth()] + " " + m.getFullYear()
    : String(m);
}
// identiti: email jika berdaftar, jika tidak nama+kelas (guest)
function identity(email, nama, kelas){ return email ? ("e:" + email) : ("g:" + up(nama) + "|" + up(kelas)); }

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

function sheetAcc() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Akaun");
  if (!sh) {
    sh = ss.insertSheet("Akaun");
    sh.appendRow(["Email","PIN","Nickname","Kelas","Lencana","Statistik","Didaftar","VsMenang","VsKalah","VsSeri","VsMata"]);
  }
  if (sh.getLastColumn() < 11 || String(sh.getRange(1,11).getValue()) !== "VsMata") {
    sh.getRange(1,8,1,4).setValues([["VsMenang","VsKalah","VsSeri","VsMata"]]);
  }
  return sh;
}

// ---- Akaun VS lajur: A8 menang, A9 kalah, A10 seri, A11 mata ----
var AV = { MENANG:8, KALAH:9, SERI:10, MATA:11 };

function sheetVS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("VS");
  if (!sh) {
    sh = ss.insertSheet("VS");
    sh.appendRow(["Masa","MatchID","CEmail","CNama","CKelas","OEmail","ONama","OKelas","Status","Seed","CSkor","OSkor","Cipta","Terima"]);
  }
  return sh;
}
var V = { MASA:0, ID:1, CE:2, CN:3, CK:4, OE:5, ON:6, OK:7, STATUS:8, SEED:9, CS:10, OS:11, CIPTA:12, TERIMA:13 };

var FIREBASE_DB_URL = "https://sifir-juara-default-rtdb.asia-southeast1.firebasedatabase.app";

function firebaseHashEmail_(email) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(email || "").trim().toLowerCase(),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b){
    var v = b < 0 ? b + 256 : b;
    return ("0" + v.toString(16)).slice(-2);
  }).join("");
}

function firebaseBase64Url_(value) {
  return Utilities.base64EncodeWebSafe(value).replace(/=+$/, "");
}

function firebaseAccessToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("firebaseAdminAccessToken");
  if (cached) return cached;

  var encoded = PropertiesService.getScriptProperties().getProperty("firebaseServiceAccount");
  if (!encoded) throw new Error("Kelayakan Firebase belum disediakan");
  var json = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString();
  var service = JSON.parse(json);
  var now = Math.floor(Date.now() / 1000);
  var header = firebaseBase64Url_(JSON.stringify({alg:"RS256", typ:"JWT"}));
  var claim = firebaseBase64Url_(JSON.stringify({
    iss:service.client_email,
    scope:"https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud:"https://oauth2.googleapis.com/token",
    iat:now,
    exp:now + 3600
  }));
  var unsigned = header + "." + claim;
  var signature = Utilities.computeRsaSha256Signature(unsigned, service.private_key);
  var assertion = unsigned + "." + Utilities.base64EncodeWebSafe(signature).replace(/=+$/, "");
  var response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method:"post",
    payload:{
      grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:assertion
    },
    muteHttpExceptions:true
  });
  var code = response.getResponseCode();
  var body = JSON.parse(response.getContentText() || "{}");
  if (code < 200 || code >= 300 || !body.access_token) {
    throw new Error("Token Firebase gagal: " + code);
  }
  cache.put("firebaseAdminAccessToken", body.access_token, 3300);
  return body.access_token;
}

function firebaseRequest_(method, path, data) {
  var clean = String(path || "").replace(/^\/+/, "");
  var url = FIREBASE_DB_URL + "/" + (clean ? clean + ".json" : ".json");
  var res = UrlFetchApp.fetch(url, {
    method: method,
    contentType: "application/json",
    payload: JSON.stringify(data),
    headers: { Authorization: "Bearer " + firebaseAccessToken_() },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Firebase " + code + ": " + res.getContentText().slice(0, 180));
  }
  return true;
}

function firebasePatchRoot_(updates) {
  try {
    var ok = firebaseRequest_("patch", "", updates);
    PropertiesService.getScriptProperties().setProperty("firebaseLastStatus", "OK " + new Date().toISOString());
    return ok;
  } catch (err) {
    var msg = String(err && err.message ? err.message : err);
    PropertiesService.getScriptProperties().setProperty("firebaseLastStatus", "ERROR " + msg.slice(0, 300));
    console.error("Firebase sync gagal: " + msg);
    return false;
  }
}

// Papan markah Firebase = bulan semasa sahaja.
function firebaseScoreBoardData_() {
  return papanMarkahBulan_(bulanKini_());
}

function firebaseVsBoardData_() {
  var sh = sheetAcc();
  var rows = sh.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var nick = up(rows[i][2]);
    if (!nick) continue;
    var stats = {};
    try { stats = JSON.parse(rows[i][5] || "{}"); } catch (ignore) {}
    list.push({
      nick:nick, kelas:up(rows[i][3]),
      avatar:(typeof stats.avatar === "number") ? stats.avatar : 0,
      level:levelFromXP(stats.totalCorrect || 0),
      menang:Number(rows[i][AV.MENANG - 1]) || 0,
      kalah:Number(rows[i][AV.KALAH - 1]) || 0,
      mata:Number(rows[i][AV.MATA - 1]) || 0
    });
  }
  list.sort(function(a,b){ return b.mata - a.mata; });
  return list;
}

function firebaseSyncLeaderboards_() {
  return firebasePatchRoot_({
    "leaderboards/score": firebaseScoreBoardData_(),
    "leaderboards/vs": firebaseVsBoardData_(),
    "leaderboards/updatedAt": Date.now()
  });
}

function firebaseVsView_(row, iAmC, accounts) {
  var ce = String(row[V.CE]).trim().toLowerCase();
  var oe = String(row[V.OE]).trim().toLowerCase();
  var oppEmail = iAmC ? oe : ce;
  var om = accounts[oppEmail] || {};
  return {
    id:String(row[V.ID]), seed:Number(row[V.SEED]) || 0,
    status:String(row[V.STATUS]), iAmChallenger:iAmC,
    oppNick:iAmC ? up(row[V.ON]) : up(row[V.CN]),
    oppKelas:iAmC ? up(row[V.OK]) : up(row[V.CK]),
    oppAvatar:om.avatar || 0, oppLevel:om.level || 1,
    myScore:iAmC ? vScore(row[V.CS]) : vScore(row[V.OS]),
    oppScore:iAmC ? vScore(row[V.OS]) : vScore(row[V.CS]),
    date:fmtDate(row[V.MASA]), updatedAt:Date.now()
  };
}

function firebaseVsUpdates_(row) {
  var ce = String(row[V.CE]).trim().toLowerCase();
  var oe = String(row[V.OE]).trim().toLowerCase();
  var id = String(row[V.ID]);
  var accounts = accMap(sheetAcc());
  var updates = {};
  updates["vsUsers/" + firebaseHashEmail_(ce) + "/" + id] = firebaseVsView_(row, true, accounts);
  updates["vsUsers/" + firebaseHashEmail_(oe) + "/" + id] = firebaseVsView_(row, false, accounts);
  updates["vsMatches/" + id] = {
    id:id, status:String(row[V.STATUS]), seed:Number(row[V.SEED]) || 0,
    challenger:{nick:up(row[V.CN]), kelas:up(row[V.CK]), score:vScore(row[V.CS])},
    opponent:{nick:up(row[V.ON]), kelas:up(row[V.OK]), score:vScore(row[V.OS])},
    updatedAt:Date.now()
  };
  return updates;
}

function firebaseSyncVsRow_(row) {
  return firebasePatchRoot_(firebaseVsUpdates_(row));
}

function firebaseSyncVsMatch_(matchId) {
  if (!matchId) return false;
  var vs = sheetVS();
  var r = vsFindRow(vs, matchId);
  if (r < 0) return false;
  return firebaseSyncVsRow_(vs.getRange(r, 1, 1, 14).getValues()[0]);
}

function firebaseSeedAll() {
  var updates = {
    "leaderboards/score": firebaseScoreBoardData_(),
    "leaderboards/vs": firebaseVsBoardData_(),
    "leaderboards/updatedAt": Date.now()
  };
  var rows = sheetVS().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var extra = firebaseVsUpdates_(rows[i]);
    for (var k in extra) updates[k] = extra[k];
  }
  var ok = firebasePatchRoot_(updates);
  return {ok:ok, matches:Math.max(0, rows.length - 1)};
}


function findAcc(sh, email) {
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === email) return i + 1;
  }
  return -1;
}

/* ---------- ROUTER ---------- */
function doPost(e) {
  var out, lock = null;
  try {
    var d = JSON.parse(e.postData.contents);
    var a = d.action || "score";
    var locked = {
      score:true, game_start:true, game_end:true, register:true, reset:true, sync:true,
      vs_invite:true, vs_accept:true, vs_decline:true, vs_cancel:true, vs_submit:true
    };
    if (locked[a]) {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
    }
    if (a === "score" || a === "game_end") out = addScoreRow(d);
    else if (a === "game_start") out = startGameSession(d);
    else if (a === "register") out = regAcc(d);
    else if (a === "login") out = loginAcc(d);
    else if (a === "reset") out = resetAcc(d);
    else if (a === "sync") out = syncAcc(d);
    else if (a === "profile") out = getProfile(d);
    else if (a === "vs_players") out = vsPlayers(d);
    else if (a === "vs_invite") out = vsInvite(d);
    else if (a === "vs_list") out = vsList(d);
    else if (a === "vs_accept") out = vsRespond(d, "accepted");
    else if (a === "vs_decline") out = vsRespond(d, "declined");
    else if (a === "vs_cancel") out = vsCancel(d);
    else if (a === "vs_submit") out = vsSubmit(d);
    else if (a === "vs_board") out = vsBoard(d);
    else out = { ok:false, err:"Tindakan tidak sah" };
  } catch (err) {
    out = { ok:false, err:"Ralat pelayan" };
  } finally {
    if (lock) try { lock.releaseLock(); } catch (ignore) {}
  }
  try {
    if (out && out.ok) {
      if ((a === "score" || a === "game_end") && out.saved) firebaseSyncLeaderboards_();
      if (a === "register" || a === "sync") firebaseSyncLeaderboards_();
      if (a === "vs_invite") firebaseSyncVsMatch_(out.matchId);
      else if (a === "vs_accept" || a === "vs_decline" || a === "vs_cancel" || a === "vs_submit") {
        firebaseSyncVsMatch_(d.matchId);
      }
    }
  } catch (firebaseErr) {
    console.error("Firebase selepas tindakan gagal: " + firebaseErr);
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- MARKAH: simpan markah tertinggi setiap bulan (upsert) ---------- */

function deriveBadges(stats, badges, mode, score, betul, salah, streak) {
  badges = badges || {};
  badges.first = true;
  if (stats.games >= 5) badges.games5 = true;
  if (stats.games >= 20) badges.games20 = true;
  if (stats.games >= 50) badges.games50 = true;
  if (stats.totalCorrect >= 100) badges.c100 = true;
  if (stats.totalCorrect >= 500) badges.c500 = true;
  if (stats.totalCorrect >= 1000) badges.c1000 = true;
  if (streak >= 3) badges.s3 = true;
  if (streak >= 5) badges.s5 = true;
  if (streak >= 10) badges.s10 = true;
  if (MODE_MAP[mode]) {
    if (score >= 100) badges.m100 = true;
    if (score >= 200) badges.m200 = true;
    if (score >= 300) badges.m300 = true;
    if (score >= 500) badges.m500 = true;
    if (score >= 750) badges.m750 = true;
  }
  if (betul + salah >= 10 && salah === 0) badges.perfect = true;
  if (mode === "Hero") { badges.hero = true; if (score >= 100) badges.hero100 = true; }
  if (mode === "Latihan") badges.prac = true;
  if (stats.modes && stats.modes.easy && stats.modes.mid && stats.modes.hard && stats.modes.hero) badges.all = true;
  var lv = levelFromXP(stats.totalCorrect || 0);
  if (lv >= 5) badges.lv5 = true;
  if (lv >= 10) badges.lv10 = true;
  if (lv >= 20) { badges.lv20 = true; badges.avatarAll = true; }
  return badges;
}

function accountGameStats(email, mode, score, betul, salah, streak) {
  if (!email) return null;
  var sh = sheetAcc();
  var r = findAcc(sh, email);
  if (r < 0) return null;
  var row = sh.getRange(r, 5, 1, 2).getValues()[0];
  var badges = {}, stats = {};
  try { badges = JSON.parse(row[0] || "{}"); } catch (e) {}
  try { stats = JSON.parse(row[1] || "{}"); } catch (e) {}
  stats.games = (Number(stats.games) || 0) + 1;
  stats.totalCorrect = (Number(stats.totalCorrect) || 0) + betul;
  stats.totalWrong = (Number(stats.totalWrong) || 0) + salah;
  stats.bestStreak = Math.max(Number(stats.bestStreak) || 0, streak);
  if (!stats.modes) stats.modes = {};
  var key = MODE_MAP[mode];
  if (key) stats.modes[key] = true;
  badges = deriveBadges(stats, badges, mode, score, betul, salah, streak);
  sh.getRange(r, 5, 1, 2).setValues([[JSON.stringify(badges), JSON.stringify(stats)]]);
  return { stats:stats, badges:badges };
}

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
    if (bulanOf_(rows[i]) !== bkini) continue;      // hanya bandingkan dalam bulan ini
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

/* ---------- PURGE (throttle 30 min; tulis-semula laju) ---------- */
function maybePurge(sh) {
  try {
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty("lastPurge") || 0);
    if (Date.now() - last < 30 * 60 * 1000) return;
    props.setProperty("lastPurge", String(Date.now()));
  } catch (e) {}
  purge(sh);
}

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

/* ---------- AKAUN ---------- */
function nickTaken(sh, nick, exceptRow) {
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if ((i + 1) !== exceptRow && up(rows[i][2]) === up(nick)) return true;
  }
  return false;
}

function regAcc(d) {
  var email = String(d.email || "").trim().toLowerCase();
  var pass  = String(d.pass || "");
  var nick  = up(d.nickname);
  var kelas = up(d.kelas);
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok:false, err:"Email tidak sah" };
  if (!/^\d{4}$/.test(pass)) return { ok:false, err:"PIN mesti 4 angka" };
  if (!nick) return { ok:false, err:"Nickname diperlukan" };
  var sh = sheetAcc();
  if (findAcc(sh, email) > 0) return { ok:false, err:"Email ini sudah didaftarkan" };
  if (nickTaken(sh, nick, -1)) return { ok:false, err:"Nickname sudah digunakan" };
  sh.appendRow([email, "'" + pass, nick, kelas, "{}", "{}", new Date()]);
  return { ok:true, nickname:nick, kelas:kelas };
}

function loginAcc(d) {
  var email = String(d.email || "").trim().toLowerCase();
  var sh = sheetAcc();
  var r = findAcc(sh, email);
  if (r < 0) return { ok:false, err:"Email belum didaftarkan" };
  var row = sh.getRange(r, 1, 1, 11).getValues()[0];
  if (String(row[1]).replace(/^'/, "") !== String(d.pass || "")) return { ok:false, err:"PIN salah" };
  var badges = {}, stats = {};
  try { badges = JSON.parse(row[4] || "{}"); } catch (e) {}
  try { stats = JSON.parse(row[5] || "{}"); } catch (e) {}
  stats.vsWins = Number(row[7]) || 0;
  stats.vsLosses = Number(row[8]) || 0;
  stats.vsDraws = Number(row[9]) || 0;
  stats.vsMata = Number(row[10]) || 0;
  return { ok:true, nickname:up(row[2]), kelas:up(row[3]), badges:badges, stats:stats };
}

function resetAcc(d) {
  var email = String(d.email || "").trim().toLowerCase();
  var sh = sheetAcc();
  var r = findAcc(sh, email);
  if (r < 0) return { ok:false, err:"Email belum didaftarkan" };
  var pin = String(sh.getRange(r, 2).getValue()).replace(/^'/, "");
  MailApp.sendEmail(email, "Sifir Juara — PIN anda",
    "Salam,\n\nPIN akaun Sifir Juara anda ialah: " + pin + "\n\nSelamat bermain!");
  return { ok:true };
}

function syncAcc(d) {
  var email = String(d.email || "").trim().toLowerCase();
  var sh = sheetAcc();
  var r = findAcc(sh, email);
  if (r < 0) return { ok:false, err:"Email belum didaftarkan" };
  var pin = String(sh.getRange(r, 2).getValue()).replace(/^'/, "");
  if (pin !== String(d.pass || "")) return { ok:false, err:"PIN salah" };

  var old = sh.getRange(r, 3, 1, 4).getValues()[0];
  var oldNick = up(old[0]), oldKelas = up(old[1]);
  var nick = up(d.nickname) || oldNick;
  var kelas = up(d.kelas) || oldKelas;
  if (nickTaken(sh, nick, r)) return { ok:false, err:"Nickname sudah digunakan" };

  var badges = {}, stats = {};
  try { badges = JSON.parse(old[2] || "{}"); } catch (e) {}
  try { stats = JSON.parse(old[3] || "{}"); } catch (e) {}
  var avatar = Number(d.avatar);
  if (isFinite(avatar) && Math.floor(avatar) === avatar && avatar >= 0 && avatar <= 19) stats.avatar = avatar;
  sh.getRange(r, 3, 1, 4).setValues([[nick, kelas, JSON.stringify(badges), JSON.stringify(stats)]]);

  if (nick !== oldNick || kelas !== oldKelas) {
    var msh = markahSheet();
    var rows = msh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (emailOf(rows[i]) === email) msh.getRange(i + 1, 2, 1, 2).setValues([[nick, kelas]]);
    }
    CacheService.getScriptCache().remove(kunciCacheLb_());
  }
  return { ok:true, nickname:nick, kelas:kelas, badges:badges, stats:stats };
}

/* ---------- PROFIL ---------- */
function getProfile(d) {
  var nick = up(d.nickname);
  if (!nick) return { ok:false, err:"Nickname diperlukan" };
  var acc = sheetAcc();
  var rows = acc.getDataRange().getValues();
  var found = null, email = "";
  for (var i = 1; i < rows.length; i++) {
    if (up(rows[i][2]) === nick) { found = rows[i]; email = String(rows[i][0]).trim().toLowerCase(); break; }
  }
  if (!found) return { ok:false, err:"Profil tidak dijumpai (pemain tetamu tiada profil)" };

  var badges = {}, stats = {};
  try { badges = JSON.parse(found[4] || "{}"); } catch (e) {}
  try { stats = JSON.parse(found[5] || "{}"); } catch (e) {}

  // markah tertinggi: bulan semasa, sepanjang masa, dan pecahan setiap bulan
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

  return {
    ok: true,
    nickname: up(found[2]),
    kelas: up(found[3]),
    badges: badges,
    stats: {
      games: stats.games || 0,
      totalCorrect: stats.totalCorrect || 0,        // dari Akaun (dikumpul aplikasi)
      totalWrong: stats.totalWrong || 0,            // dari Akaun
      bestStreak: Math.max(stats.bestStreak || 0, maxStreak),
      avatar: (typeof stats.avatar === "number") ? stats.avatar : 0,
      vsMenang: Number(found[7]) || 0,
      vsKalah: Number(found[8]) || 0,
      vsMata: Number(found[10]) || 0
    },
    highs: highs,
    highsAll: highsAll,
    bulanan: bulanan,
    bulan: bkini
  };
}

/* ================= MOD VS (async jemputan) ================= */
function tParse(v){ return (v instanceof Date) ? v.getTime() : (Date.parse(v) || 0); }
function vScore(x){ var n = Number(x); return isNaN(n) ? -1 : n; }
function levelFromXP(xp){ return Math.min(20, Math.floor((xp || 0) / 100) + 1); }

function authVS(d){
  var email = String(d.email || "").trim().toLowerCase();
  var sh = sheetAcc();
  var r = findAcc(sh, email);
  if (r < 0) return null;
  var pin = String(sh.getRange(r, 2).getValue()).replace(/^'/, "");
  if (pin !== String(d.pass || "")) return null;
  return { sh: sh, r: r, email: email };
}

// peta akaun: email -> {nick, kelas, avatar, level}
function accMap(sh){
  var rows = sh.getDataRange().getValues();
  var m = {};
  for (var i = 1; i < rows.length; i++){
    var e = String(rows[i][0]).trim().toLowerCase();
    if (!e) continue;
    var stats = {}; try{ stats = JSON.parse(rows[i][5] || "{}"); }catch(x){}
    m[e] = { nick: up(rows[i][2]), kelas: up(rows[i][3]),
      avatar: (typeof stats.avatar === "number") ? stats.avatar : 0,
      level: levelFromXP(stats.totalCorrect || 0) };
  }
  return m;
}

function vsPlayers(d){
  var a = authVS(d); if (!a) return { ok:false, err:"Sesi tidak sah" };
  var m = accMap(a.sh);
  var busy = {};
  var vs = sheetVS(); vsExpire(vs);
  var rows = vs.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++){
    var st = rows[i][V.STATUS];
    if (st !== "pending" && st !== "accepted") continue;
    var ce = String(rows[i][V.CE]).trim().toLowerCase();
    var oe = String(rows[i][V.OE]).trim().toLowerCase();
    if (ce === a.email) busy[oe] = true;
    else if (oe === a.email) busy[ce] = true;
  }
  var list = [];
  for (var e in m){
    if (e === a.email || busy[e] || !m[e].nick) continue;
    list.push({ email: e, nick: m[e].nick, kelas: m[e].kelas, avatar: m[e].avatar, level: m[e].level });
  }
  list.sort(function(x,y){ return x.nick < y.nick ? -1 : 1; });
  return { ok:true, players:list };
}

function vsInvite(d){
  var a = authVS(d); if (!a) return { ok:false, err:"Sesi tidak sah" };
  var target = String(d.targetEmail || "").trim().toLowerCase();
  if (!target || target === a.email) return { ok:false, err:"Lawan tidak sah" };
  var tr = findAcc(a.sh, target);
  if (tr < 0) return { ok:false, err:"Pemain tidak dijumpai" };
  var vs = sheetVS(); vsExpire(vs);
  var rows = vs.getDataRange().getValues();
  var pendingSent = 0;
  for (var i = 1; i < rows.length; i++){
    var st = rows[i][V.STATUS];
    var ce = String(rows[i][V.CE]).trim().toLowerCase();
    var oe = String(rows[i][V.OE]).trim().toLowerCase();
    if (ce === a.email && st === "pending") pendingSent++;
    if ((st === "pending" || st === "accepted") &&
        ((ce === a.email && oe === target) || (ce === target && oe === a.email))){
      return { ok:false, err:"Sudah ada perlawanan dengan pemain ini" };
    }
  }
  if (pendingSent >= 5) return { ok:false, err:"Had 5 jemputan tercapai" };
  var m = accMap(a.sh);
  var me = m[a.email], op = m[target];
  var id = Utilities.getUuid().slice(0, 8);
  var seed = Math.floor(Math.random() * 1e9);
  vs.appendRow([new Date(), id, a.email, me.nick, me.kelas, target, op.nick, op.kelas,
    "pending", seed, -1, -1, new Date(), ""]);
  return { ok:true, matchId:id };
}


function readVsStats(sh, email) {
  var r = findAcc(sh, String(email || "").trim().toLowerCase());
  if (r < 0) return { menang:0, kalah:0, seri:0, mata:0 };
  var v = sh.getRange(r, AV.MENANG, 1, 4).getValues()[0];
  return { menang:Number(v[0]) || 0, kalah:Number(v[1]) || 0,
    seri:Number(v[2]) || 0, mata:Number(v[3]) || 0 };
}

function deriveVsBadges(sh, email) {
  var r = findAcc(sh, email);
  if (r < 0) return;
  var badges = {};
  try { badges = JSON.parse(sh.getRange(r, 5).getValue() || "{}"); } catch (e) {}
  var v = readVsStats(sh, email);
  if (v.menang >= 1) badges.vsWin1 = true;
  if (v.menang >= 10) badges.vsWin10 = true;
  if (v.mata >= 1) badges.vsPejuang = true;
  if (v.mata >= 50) badges.vsPerwira = true; if (v.mata >= 150) badges.vsJaguh = true; if (v.mata >= 350) badges.vsHulubalang = true;
  if (v.mata >= 700) badges.vsLegenda = true;
  sh.getRange(r, 5).setValue(JSON.stringify(badges));
}

function finishVsMatch(vs, rowNum, row, acc) {
  if (row[V.STATUS] !== "accepted") return null;
  var cs = vScore(row[V.CS]), os = vScore(row[V.OS]);
  if (cs < 0 || os < 0) return null;
  var ce = String(row[V.CE]).trim().toLowerCase();
  var oe = String(row[V.OE]).trim().toLowerCase();
  var result;
  if (cs === os) {
    result = "draw"; addVsPoints(acc, ce, "draw"); addVsPoints(acc, oe, "draw");
  } else if (cs > os) {
    result = ce; addVsPoints(acc, ce, "win"); addVsPoints(acc, oe, "lose");
  } else {
    result = oe; addVsPoints(acc, oe, "win"); addVsPoints(acc, ce, "lose");
  }
  deriveVsBadges(acc, ce); deriveVsBadges(acc, oe);
  vs.getRange(rowNum, V.STATUS + 1).setValue("done");
  return { result:result, cs:cs, os:os };
}

function vsList(d) {
  var a = authVS(d); if (!a) return { ok:false, err:"Sesi tidak sah" };
  var vs = sheetVS(); vsExpire(vs);
  var m = accMap(a.sh);
  var rows = vs.getDataRange().getValues();
  var incoming = [], active = [], sent = [], recent = [];
  for (var i = 1; i < rows.length; i++){
    var r = rows[i];
    var ce = String(r[V.CE]).trim().toLowerCase();
    var oe = String(r[V.OE]).trim().toLowerCase();
    var iAmC = (ce === a.email), iAmO = (oe === a.email);
    if (!iAmC && !iAmO) continue;
    var oppE = iAmC ? oe : ce;
    var om = m[oppE] || {};
    var mm = {
      id:r[V.ID], seed:r[V.SEED], status:r[V.STATUS], iAmChallenger:iAmC,
      oppNick:iAmC ? up(r[V.ON]) : up(r[V.CN]),
      oppKelas:iAmC ? up(r[V.OK]) : up(r[V.CK]),
      oppAvatar:om.avatar || 0, oppLevel:om.level || 1,
      myScore:iAmC ? vScore(r[V.CS]) : vScore(r[V.OS]),
      oppScore:iAmC ? vScore(r[V.OS]) : vScore(r[V.CS]),
      date:fmtDate(r[V.MASA])
    };
    if (r[V.STATUS] === "pending") (iAmO ? incoming : sent).push(mm);
    else if (r[V.STATUS] === "accepted") active.push(mm);
    else if (r[V.STATUS] === "done") recent.push(mm);
  }
  if (recent.length > 5) recent = recent.slice(recent.length - 5);
  return { ok:true, incoming:incoming, active:active, sent:sent, recent:recent,
    vsStats:readVsStats(a.sh, a.email) };
}

function vsFindRow(vs, id){
  var rows = vs.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++){ if (String(rows[i][V.ID]) === String(id)) return i + 1; }
  return -1;
}

function vsRespond(d, newStatus){
  var a = authVS(d); if (!a) return { ok:false, err:"Sesi tidak sah" };
  var vs = sheetVS();
  var r = vsFindRow(vs, d.matchId);
  if (r < 0) return { ok:false, err:"Perlawanan tidak dijumpai" };
  var row = vs.getRange(r, 1, 1, 14).getValues()[0];
  if (String(row[V.OE]).trim().toLowerCase() !== a.email) return { ok:false, err:"Bukan jemputan anda" };
  if (row[V.STATUS] !== "pending") return { ok:false, err:"Jemputan sudah dijawab" };
  vs.getRange(r, V.STATUS + 1).setValue(newStatus);
  if (newStatus === "accepted") vs.getRange(r, V.TERIMA + 1).setValue(new Date());
  return { ok:true };
}

function vsCancel(d){
  var a = authVS(d); if (!a) return { ok:false, err:"Sesi tidak sah" };
  var vs = sheetVS();
  var r = vsFindRow(vs, d.matchId);
  if (r < 0) return { ok:false, err:"Perlawanan tidak dijumpai" };
  var row = vs.getRange(r, 1, 1, 14).getValues()[0];
  if (String(row[V.CE]).trim().toLowerCase() !== a.email) return { ok:false, err:"Bukan jemputan anda" };
  if (row[V.STATUS] !== "pending" && row[V.STATUS] !== "accepted") return { ok:false, err:"Tidak boleh dibatalkan" };
  vs.getRange(r, V.STATUS + 1).setValue("cancelled");
  return { ok:true };
}

function addVsPoints(sh, email, kind){
  var r = findAcc(sh, email);
  if (r < 0) return;
  var vals = sh.getRange(r, AV.MENANG, 1, 4).getValues()[0];
  var menang = Number(vals[0]) || 0, kalah = Number(vals[1]) || 0, seri = Number(vals[2]) || 0, mata = Number(vals[3]) || 0;
  if (kind === "win"){ menang++; mata += 10; }
  else if (kind === "draw"){ seri++; mata += 5; }
  else {
    kalah++;
    if (mata >= 150) mata = Math.max(0, mata - 5);  // Jaguh ke atas: mata ditolak
    else mata += 2;                                  // bawah Jaguh: mata penyertaan
  }
  sh.getRange(r, AV.MENANG, 1, 4).setValues([[menang, kalah, seri, mata]]);
}

function vsSubmit(d){
  var a = authVS(d); if (!a) return { ok:false, err:"Sesi tidak sah" };
  var vs = sheetVS();
  var r = vsFindRow(vs, d.matchId);
  if (r < 0) return { ok:false, err:"Perlawanan tidak dijumpai" };
  var row = vs.getRange(r, 1, 1, 14).getValues()[0];
  if (row[V.STATUS] !== "accepted") return { ok:false, err:"Perlawanan tidak aktif" };
  var ce = String(row[V.CE]).trim().toLowerCase(), oe = String(row[V.OE]).trim().toLowerCase();
  var iAmC = (ce === a.email), iAmO = (oe === a.email);
  if (!iAmC && !iAmO) return { ok:false, err:"Bukan perlawanan anda" };

  var repaired = finishVsMatch(vs, r, row, a.sh);
  if (repaired) {
    var repairedResult = repaired.result === "draw" ? "draw" : (repaired.result === a.email ? "win" : "lose");
    var repairedStats = readVsStats(a.sh, a.email);
    return { ok:true, done:true, myScore:iAmC ? repaired.cs : repaired.os,
      oppScore:iAmC ? repaired.os : repaired.cs, result:repairedResult,
      mata:repairedStats.mata, vsStats:repairedStats, repaired:true };
  }

  var checked = validateGameResult(d);
  if (!checked.ok || checked.session.mode !== "VS") return checked.ok ? {ok:false,err:"Sesi VS tidak sah"} : checked;
  var score = checked.score;
  if (iAmC) {
    if (vScore(row[V.CS]) >= 0) return { ok:false, err:"Anda sudah main" };
    vs.getRange(r, V.CS + 1).setValue(score); row[V.CS] = score;
  } else {
    if (vScore(row[V.OS]) >= 0) return { ok:false, err:"Anda sudah main" };
    vs.getRange(r, V.OS + 1).setValue(score); row[V.OS] = score;
  }

  var gameStats = accountGameStats(a.email, "VS", score, checked.betul, checked.salah, checked.streak);
  var finished = finishVsMatch(vs, r, row, a.sh);
  useGameSession(checked.session);
  var current = readVsStats(a.sh, a.email);
  if (finished) {
    var result = finished.result === "draw" ? "draw" : (finished.result === a.email ? "win" : "lose");
    return { ok:true, done:true, myScore:score, oppScore:iAmC ? finished.os : finished.cs,
      result:result, mata:current.mata, vsStats:current,
      stats:gameStats ? gameStats.stats : null, badges:gameStats ? gameStats.badges : null };
  }
  return { ok:true, done:false, myScore:score, oppScore:-1, vsStats:current,
    stats:gameStats ? gameStats.stats : null, badges:gameStats ? gameStats.badges : null };
}

function vsBoard(d){
  var a = authVS(d); if (!a) return { ok:false, err:"Sesi tidak sah" };
  var rows = a.sh.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++){
    var nick = up(rows[i][2]);
    if (!nick) continue;
    var stats = {}; try{ stats = JSON.parse(rows[i][5] || "{}"); }catch(x){}
    list.push({ nick: nick, kelas: up(rows[i][3]),
      avatar: (typeof stats.avatar === "number") ? stats.avatar : 0,
      level: levelFromXP(stats.totalCorrect || 0),
      menang: Number(rows[i][AV.MENANG - 1]) || 0,
      kalah: Number(rows[i][AV.KALAH - 1]) || 0,
      mata: Number(rows[i][AV.MATA - 1]) || 0 });
  }
  list.sort(function(x,y){ return y.mata - x.mata; });
  return { ok:true, board:list };
}

function vsExpire(vs){
  var rows = vs.getDataRange().getValues();
  var now = Date.now();
  for (var i = 1; i < rows.length; i++){
    var st = rows[i][V.STATUS];
    if (st === "pending"){
      if (now - tParse(rows[i][V.CIPTA]) > GUEST_MS) {
        vs.getRange(i + 1, V.STATUS + 1).setValue("expired");
        rows[i][V.STATUS] = "expired"; firebaseSyncVsRow_(rows[i]);
      }
    } else if (st === "accepted"){
      var both = (vScore(rows[i][V.CS]) >= 0 && vScore(rows[i][V.OS]) >= 0);
      if (!both && now - tParse(rows[i][V.TERIMA]) > GUEST_MS) {
        vs.getRange(i + 1, V.STATUS + 1).setValue("expired");
        rows[i][V.STATUS] = "expired"; firebaseSyncVsRow_(rows[i]);
      }
    }
  }
}

/* ---------- PAPAN MARKAH (baca sahaja, laju) ---------- */
// Hanya bulan semasa. Kunci cache mengandungi bulan, jadi papan bulan lepas
// tidak boleh tersangkut selepas bulan bertukar.
function doGet(e) {
  var cache = CacheService.getScriptCache();
  var kunci = kunciCacheLb_();
  var cached = cache.get(kunci);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  var json = JSON.stringify(papanMarkahBulan_(bulanKini_()));
  cache.put(kunci, json, 30);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- BACKFILL (RUN SEKALI SEBELUM DEPLOY) ----------
 * Jumlahkan Betul/Salah & ambil streak tertinggi dari SEMUA rekod Markah sedia ada,
 * masukkan ke statistik Akaun setiap pengguna berdaftar. Kemudian purge akan
 * mengecilkan Markah ke baris tertinggi setiap bulan.
 */
/**
 * LINDUNG SHEET DARI TERSALAH EDIT (RUN SEKALI).
 * Pasang perlindungan "amaran sahaja" pada tab Markah, Akaun, VS.
 * Bila anda cuba edit sel, Google Sheets akan minta pengesahan dahulu.
 * Skrip game TIDAK terjejas (ia tulis secara automatik tanpa amaran).
 * Untuk buang: Data > Protected sheets and ranges > pilih > Remove.
 */
function protectSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ["Markah","Akaun","VS"].forEach(function(name){
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function(p){ p.remove(); });
    sh.protect().setDescription("Amaran edit - " + name).setWarningOnly(true);
  });
}

function backfillStats() {
  var acc = sheetAcc();
  var accRows = acc.getDataRange().getValues();
  var msh = markahSheet();
  var mrows = msh.getDataRange().getValues();

  for (var a = 1; a < accRows.length; a++) {
    var email = String(accRows[a][0]).trim().toLowerCase();
    if (!email) continue;
    var sumB = 0, sumS = 0, maxSt = 0;
    for (var j = 1; j < mrows.length; j++) {
      if (emailOf(mrows[j]) === email) {
        sumB += Number(mrows[j][C.BETUL]) || 0;
        sumS += Number(mrows[j][C.SALAH]) || 0;
        maxSt = Math.max(maxSt, Number(mrows[j][C.STREAK]) || 0);
      }
    }
    var stats = {};
    try { stats = JSON.parse(accRows[a][5] || "{}"); } catch (e) {}
    stats.totalCorrect = Math.max(stats.totalCorrect || 0, sumB);
    stats.totalWrong   = Math.max(stats.totalWrong || 0, sumS);
    stats.bestStreak   = Math.max(stats.bestStreak || 0, maxSt);
    if (!stats.modes) stats.modes = {};
    acc.getRange(a + 1, 6).setValue(JSON.stringify(stats));
  }
  // kecilkan Markah ke baris tertinggi setiap bulan
  try { PropertiesService.getScriptProperties().deleteProperty("lastPurge"); } catch (e) {}
  purge(msh);
}
