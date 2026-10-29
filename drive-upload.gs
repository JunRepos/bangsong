/* 진로방송부 — 부원 영상을 선생님 구글 드라이브로 받는 창구 (Google Apps Script)

   만드는 법 (선생님 구글 계정으로, 한 번만)
   1. https://script.google.com → [새 프로젝트] → 이 파일 내용을 전부 붙여 넣고 저장
   2. 오른쪽 위 [배포] → [새 배포] → 유형 ⚙ [웹 앱]
        - 다음 사용자 인증 정보로 실행: 나
        - 액세스 권한이 있는 사용자: 모든 사용자
   3. [배포] → 권한 검토 → 계정 선택 → (확인되지 않은 앱이면) 고급 → 이동 → 허용
   4. 나온 '웹 앱 URL'(…/exec)을 복사해서
      방송부 사이트 → 스튜디오 → 방송국 정보 → '영상 받을 구글 드라이브' 칸에 붙여 넣고 저장

   올라온 영상은 내 드라이브 '방송부 영상 / 작품 제목' 폴더에 '학번 이름_파일이름'으로 쌓입니다.
   사이트에 로그인한 방송부 부원(가입 코드로 들어온 학번 계정)과 선생님만 올릴 수 있습니다.
   코드를 고친 뒤에는 [배포] → [배포 관리] → ✎ → 버전 '새 버전' 으로 다시 배포해야 반영됩니다. */

var FOLDER = "방송부 영상";
var FIREBASE_API_KEY = "AIzaSyCZAWARkTkW2wn8af2tH6eFPvdOWpufo2U";   // 사이트에 들어 있는 공개 키와 같습니다
var FIREBASE_PROJECT = "schoollife-ad0f3";
// 사이트에 선생님으로 로그인하는 이메일이 이 구글 계정과 다르면 여기에 넣으세요. 예) ["teacher@school.kr"]
var TEACHERS = [];
var MAX_SIZE = 5 * 1024 * 1024 * 1024;   // 한 파일 5GB 까지

function doGet() { return out({ok: true, folder: FOLDER}); }

function doPost(e) {
  try {
    var q = JSON.parse(e.postData.contents);
    if (q.op === "start") return out(start(q));
    if (q.op === "chunk") return out(chunk(q));
    return out({error: "알 수 없는 요청입니다."});
  } catch (err) {
    return out({error: String((err && err.message) || err)});
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// 사이트 로그인 확인 → 선생님이거나, 가입한 부원(bcMembers 에 자기 문서가 있는 학번 계정)인지
function who(token) {
  var r = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY, {
    method: "post", contentType: "application/json", payload: JSON.stringify({idToken: token}),
    muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) throw new Error("로그인이 확인되지 않습니다. 사이트에서 다시 로그인해 주세요.");
  var u = (JSON.parse(r.getContentText()).users || [])[0];
  if (!u) throw new Error("로그인이 확인되지 않습니다. 사이트에서 다시 로그인해 주세요.");
  var email = String(u.email || "").toLowerCase();
  var me = String(Session.getEffectiveUser().getEmail() || "").toLowerCase();
  var teachers = TEACHERS.map(function (x) { return String(x).toLowerCase(); });
  if (email && (email === me || teachers.indexOf(email) >= 0)) return {uid: u.localId, sid: "", name: "선생님"};
  var m = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT +
                            "/databases/(default)/documents/bcMembers/" + u.localId, {
    headers: {Authorization: "Bearer " + token}, muteHttpExceptions: true
  });
  if (m.getResponseCode() !== 200) throw new Error("방송부 부원만 올릴 수 있습니다. 사이트에서 가입했는지 확인해 주세요.");
  var f = JSON.parse(m.getContentText()).fields || {};
  return {uid: u.localId, sid: (f.sid && f.sid.stringValue) || "", name: (f.name && f.name.stringValue) || ""};
}

function clean(s) { return String(s || "").replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); }

function folderFor(sub) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var it = DriveApp.getFoldersByName(FOLDER);
    var root = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
    if (!sub) return root;
    var s = root.getFoldersByName(sub);
    return s.hasNext() ? s.next() : root.createFolder(sub);
  } finally {
    lock.releaseLock();
  }
}

function header(r, name) {
  var h = r.getAllHeaders(), k;
  for (k in h) if (k.toLowerCase() === name.toLowerCase()) return [].concat(h[k])[0];
  return "";
}

function start(q) {
  var me = who(q.token);
  var size = Number(q.size) || 0;
  if (!/^video\//.test(q.type || "")) throw new Error("영상 파일만 올릴 수 있습니다.");
  if (size <= 0 || size > MAX_SIZE) throw new Error("한 파일 5GB 까지 올릴 수 있습니다.");
  var dir = folderFor(clean(q.folder));
  var name = clean([me.sid, me.name].filter(String).join(" ") + "_" + (q.name || "영상"));
  var r = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "post", contentType: "application/json; charset=UTF-8",
    payload: JSON.stringify({name: name, mimeType: q.type, parents: [dir.getId()]}),
    headers: {Authorization: "Bearer " + ScriptApp.getOAuthToken(),
              "X-Upload-Content-Type": q.type, "X-Upload-Content-Length": String(size)},
    muteHttpExceptions: true
  });
  var loc = header(r, "Location");
  if (r.getResponseCode() !== 200 || !loc) throw new Error("드라이브가 올리기를 받지 않았습니다 (" + r.getResponseCode() + ").");
  var props = PropertiesService.getScriptProperties();
  tidy(props);
  var id = Utilities.getUuid();
  props.setProperty("up_" + id, JSON.stringify({loc: loc, size: size, type: q.type, t: Date.now()}));
  return {id: id};
}

// 이틀 넘게 끝나지 않은 올리기는 지웁니다
function tidy(props) {
  var all = props.getProperties(), k, now = Date.now();
  for (k in all) {
    if (k.indexOf("up_") !== 0) continue;
    try { if (now - JSON.parse(all[k]).t > 2 * 24 * 3600 * 1000) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  }
}

function chunk(q) {
  var key = "up_" + q.id, props = PropertiesService.getScriptProperties();
  var s = JSON.parse(props.getProperty(key) || "null");
  if (!s) throw new Error("올리기가 끝났거나 너무 오래되었습니다. 영상을 다시 골라 주세요.");
  var bytes = Utilities.base64Decode(q.data);
  var from = Number(q.offset) || 0, to = from + bytes.length - 1;
  var r = UrlFetchApp.fetch(s.loc, {
    method: "put", contentType: s.type, payload: bytes,
    headers: {"Content-Range": "bytes " + from + "-" + to + "/" + s.size},
    muteHttpExceptions: true, followRedirects: false
  });
  var code = r.getResponseCode();
  if (code === 200 || code === 201) return finish(props, key, JSON.parse(r.getContentText()).id);
  if (code === 308) return {next: nextOf(r)};
  // 어긋났으면 드라이브가 어디까지 받았는지 물어보고 거기서부터
  var st = UrlFetchApp.fetch(s.loc, {
    method: "put", payload: "", headers: {"Content-Range": "bytes */" + s.size},
    muteHttpExceptions: true, followRedirects: false
  });
  if (st.getResponseCode() === 308) return {next: nextOf(st)};
  if (st.getResponseCode() === 200 || st.getResponseCode() === 201) return finish(props, key, JSON.parse(st.getContentText()).id);
  props.deleteProperty(key);
  throw new Error("드라이브가 영상을 받지 않았습니다 (" + code + "). 다시 골라 주세요.");
}

function nextOf(r) {
  var range = header(r, "Range");   // bytes=0-8388607
  return range ? Number(range.split("-")[1]) + 1 : 0;
}

function finish(props, key, id) {
  props.deleteProperty(key);
  var shared = true;
  try {
    DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    shared = false;   // 학교(워크스페이스) 계정은 관리자가 링크 공유를 막아 두기도 합니다
  }
  return {done: true, id: id, url: "https://drive.google.com/file/d/" + id + "/view", shared: shared};
}
