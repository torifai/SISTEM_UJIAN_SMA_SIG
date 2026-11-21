/*******************************************************
 * SISTEM UJIAN ONLINE SMA SIG
 * Dua mata pelajaran: Bahasa Indonesia dan Matematika
 *******************************************************/

// Isi dengan ID spreadsheet database sekolah.
const SPREADSHEET_ID = "GANTI_DENGAN_ID_SPREADSHEET";
const LOGIN_TOKEN = "GANTI_TOKEN_LOGIN_BARU";
const SUBJECT_TOKENS = {
  INDONESIA: "GANTI_TOKEN_BAHASA_INDONESIA",
  MATEMATIKA: "GANTI_TOKEN_MATEMATIKA"
};
const DURATION_MINUTES = 30;
const SESSION_LIFETIME_HOURS = 12;
const TIMEZONE = "Asia/Jakarta";
const FORM_LINKS = {
  INDONESIA: "GANTI_URL_GOOGLE_FORM_BAHASA_INDONESIA",
  MATEMATIKA: "GANTI_URL_GOOGLE_FORM_MATEMATIKA"
};
const SHEET_HEADERS = {
  HASIL_UJIAN: ["Waktu Catat","ID Sesi","Mata Pelajaran","Status","Waktu Mulai","Waktu Selesai","Keterangan"],
  LOG_AKTIVITAS: ["Waktu","ID Sesi","Mata Pelajaran","Aktivitas","Keterangan"]
};

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error("Data permintaan kosong.");
    const data = JSON.parse(e.postData.contents);
    if (!data || typeof data !== "object") throw new Error("Format permintaan tidak valid.");
    let result;
    switch (data.action) {
      case "login": result = login_(data); break;
      case "startSubject": result = startSubject_(data); break;
      case "activity": result = activity_(data); break;
      case "finish": result = finish_(data); break;
      case "logout": result = logout_(data); break;
      default: throw new Error("Aksi tidak dikenal.");
    }
    return json_({ok:true, ...result});
  } catch (error) {
    console.error(error);
    return json_({ok:false, message:error.message || "Terjadi kesalahan server."});
  }
}

function login_(data) {
  if (!safeEqual_(String(data.token || ""), LOGIN_TOKEN)) throw new Error("Token login salah.");
  const sessionToken = Utilities.getUuid();
  const now = Date.now();
  const session = {sessionToken,createdAt:now,lastSeenAt:now,expiresAt:now+SESSION_LIFETIME_HOURS*3600000,subjects:{}};
  PropertiesService.getScriptProperties().setProperty("SESSION_"+sessionToken,JSON.stringify(session));
  return {sessionToken,message:"Login berhasil."};
}

function startSubject_(data) {
  const subject = String(data.subject || "");
  const subjectToken = String(data.subjectToken || "");
  if (!SUBJECT_TOKENS[subject] || !FORM_LINKS[subject] || String(FORM_LINKS[subject]).indexOf("https://docs.google.com/forms/") !== 0) {
    throw new Error("Mata pelajaran atau URL Google Form belum dikonfigurasi.");
  }
  return withLock_(() => {
    // Validasi sesi peserta dilakukan sebelum menerima token mata pelajaran.
    const sessionToken = String(data.sessionToken || "");
    const session = getSession_(sessionToken);
    if (!safeEqual_(subjectToken,SUBJECT_TOKENS[subject])) throw new Error("Token mata pelajaran salah.");
    if (session.subjects[subject]) {
      if (session.subjects[subject].status === "BERLANGSUNG") throw new Error("Ujian mata pelajaran ini sudah dimulai.");
      throw new Error("Ujian mata pelajaran ini sudah pernah diselesaikan.");
    }
    const startedAt = Date.now();
    const deadline = startedAt + DURATION_MINUTES*60000;
    session.subjects[subject] = {startedAt,deadline,status:"BERLANGSUNG",finishedAt:null};
    session.lastSeenAt = startedAt;
    saveSession_(sessionToken,session);
    getSheet_("HASIL_UJIAN").appendRow([new Date(startedAt),sessionToken,subject,"BERLANGSUNG",new Date(startedAt),"",""]);
    return {formUrl:FORM_LINKS[subject],startedAt,deadline,duration:DURATION_MINUTES,subject,message:"Ujian berhasil dimulai."};
  });
}

function activity_(data) {
  const sessionToken=String(data.sessionToken||""), subject=String(data.subject||"");
  const activity=String(data.activity||"AKTIVITAS").slice(0,100), detail=String(data.detail||"").slice(0,500);
  return withLock_(()=>{
    const session=getSession_(sessionToken), exam=session.subjects[subject];
    if(!exam||exam.status!=="BERLANGSUNG") throw new Error("Sesi ujian tidak aktif.");
    const now=Date.now();
    if(now>=exam.deadline) throw new Error("Waktu ujian telah berakhir.");
    getSheet_("LOG_AKTIVITAS").appendRow([new Date(now),sessionToken,subject,activity,detail]);
    session.lastSeenAt=now; saveSession_(sessionToken,session);
    return {message:"Aktivitas berhasil dicatat."};
  });
}

function finish_(data) {
  const sessionToken=String(data.sessionToken||""), subject=String(data.subject||"");
  const requestedStatus=String(data.status||"SELESAI"), reason=String(data.reason||"").slice(0,500);
  return withLock_(()=>{
    const session=getSession_(sessionToken), exam=session.subjects[subject];
    if(!exam) throw new Error("Sesi ujian tidak ditemukan.");
    if(exam.status!=="BERLANGSUNG") return {status:exam.status,message:"Ujian sudah diselesaikan."};
    const now=Date.now();
    const finalStatus=now>=exam.deadline?"WAKTU HABIS":requestedStatus==="PELANGGARAN"?"PELANGGARAN":"SELESAI";
    // Perbarui sheet sebelum menandai sesi selesai agar kegagalan sheet dapat dicoba ulang.
    updateExamResult_(sessionToken,subject,finalStatus,now,reason);
    getSheet_("LOG_AKTIVITAS").appendRow([new Date(now),sessionToken,subject,"UJIAN_DITUTUP",finalStatus+" - "+reason]);
    exam.status=finalStatus; exam.finishedAt=now; session.lastSeenAt=now; saveSession_(sessionToken,session);
    return {status:finalStatus,finishedAt:now,message:"Ujian berhasil diselesaikan."};
  });
}

function updateExamResult_(sessionToken,subject,status,finishedAt,reason) {
  const sh=getSheet_("HASIL_UJIAN"), lastRow=sh.getLastRow();
  if(lastRow<2) throw new Error("Data hasil ujian tidak ditemukan.");
  const rows=sh.getRange(2,1,lastRow-1,7).getValues();
  for(let i=rows.length-1;i>=0;i--){
    const row=rows[i];
    if(String(row[1])===sessionToken&&String(row[2])===subject&&String(row[3])==="BERLANGSUNG"){
      const rowNumber=i+2;
      sh.getRange(rowNumber,4).setValue(status); sh.getRange(rowNumber,6).setValue(new Date(finishedAt)); sh.getRange(rowNumber,7).setValue(reason);
      return true;
    }
  }
  throw new Error("Baris hasil ujian tidak ditemukan.");
}

function logout_(data) {
  const sessionToken=String(data.sessionToken||"");
  if(!sessionToken) throw new Error("Token sesi tidak tersedia.");
  return withLock_(()=>{
    const session=getSession_(sessionToken);
    const activeExam=Object.keys(session.subjects).some(s=>session.subjects[s].status==="BERLANGSUNG");
    if(activeExam) throw new Error("Selesaikan seluruh ujian sebelum logout.");
    PropertiesService.getScriptProperties().deleteProperty("SESSION_"+sessionToken);
    return {message:"Logout berhasil."};
  });
}

function getSession_(sessionToken) {
  if(!sessionToken) throw new Error("Sesi tidak valid. Silakan login kembali.");
  const props=PropertiesService.getScriptProperties(), raw=props.getProperty("SESSION_"+sessionToken);
  if(!raw) throw new Error("Sesi tidak ditemukan. Silakan login kembali.");
  const session=JSON.parse(raw);
  if(!session.expiresAt||Date.now()>=session.expiresAt){props.deleteProperty("SESSION_"+sessionToken);throw new Error("Sesi telah kedaluwarsa. Silakan login kembali.");}
  return session;
}
function saveSession_(sessionToken,session){PropertiesService.getScriptProperties().setProperty("SESSION_"+sessionToken,JSON.stringify(session));}
function getSheet_(name){
  if(!SHEET_HEADERS[name]) throw new Error("Nama sheet tidak dikenal: "+name);
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID); let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  if(sh.getLastRow()===0){sh.appendRow(SHEET_HEADERS[name]);sh.setFrozenRows(1);}
  return sh;
}
function setupSheets(){
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(SHEET_HEADERS).forEach(name=>{let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.appendRow(SHEET_HEADERS[name]);sh.setFrozenRows(1);sh.getRange(1,1,1,SHEET_HEADERS[name].length).setFontWeight("bold");}});
  ss.setSpreadsheetTimeZone(TIMEZONE); return "Database SMA SIG berhasil disiapkan.";
}
function cleanupExpiredSessions(){
  const props=PropertiesService.getScriptProperties(),all=props.getProperties(),now=Date.now();let deleted=0;
  Object.keys(all).forEach(key=>{if(!key.startsWith("SESSION_"))return;try{const session=JSON.parse(all[key]);if(!session.expiresAt||now>=session.expiresAt){props.deleteProperty(key);deleted++;}}catch(e){props.deleteProperty(key);deleted++;}});
  return deleted;
}
function withLock_(callback){const lock=LockService.getScriptLock();lock.waitLock(20000);try{return callback();}finally{lock.releaseLock();}}
function safeEqual_(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function json_(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return json_({ok:true,application:"SISTEM UJIAN ONLINE SMA SIG",version:"2.2",subjects:["INDONESIA","MATEMATIKA"],duration:DURATION_MINUTES,message:"Google Apps Script SMA SIG aktif."});}
