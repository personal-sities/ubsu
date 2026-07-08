//  TIMERS
// ============================================================
function startWT(){
  stopWT();let cnt=0;
  wIv=setInterval(()=>{
    let tot=wAccum;if(wStart)tot+=Math.floor((tzNow()-wStart)/1000);setTV(tot,'tw');
    cnt++;if(cnt%30===0){saveLS();savePartial().catch(e=>console.warn('attendance autosave:',e.message||e));}
  },1000);
}
function stopWT(){if(wIv){clearInterval(wIv);wIv=null;}}
function startLT(){
  stopLT();
  lIv=setInterval(()=>{let tot=lAccum;if(lStart)tot+=Math.floor((tzNow()-lStart)/1000);setTV(tot,'tl');updateBreakBar();},1000);
}
function stopLT(){if(lIv){clearInterval(lIv);lIv=null;}}
function startBT(){
  stopBT();
  extraBreakIv=setInterval(()=>{setTV(currentExtraBreakSeconds(),'tbr');updateBreakBar();saveLS();},1000);
}
function stopBT(){if(extraBreakIv){clearInterval(extraBreakIv);extraBreakIv=null;}}
function startPT(){stopPT();pIv=setInterval(()=>{let tot=prayerAccum;if(prayerStart)tot+=Math.floor((tzNow()-prayerStart)/1000);setTV(tot,'tp');saveLS();},1000);}
function stopPT(){if(pIv){clearInterval(pIv);pIv=null;}}
function setTV(sec,id){const e=document.getElementById(id);if(e)e.textContent=fmtSec(sec);}
function stopAll(){stopWT();stopLT();stopBT();stopPT();}

function updateBreakBar(){
  const bar=document.getElementById('breakBar');const used=document.getElementById('breakUsed');
  const total=typeof currentExtraBreakSeconds==='function'?currentExtraBreakSeconds():0;
  const pct=Math.min(100,(total/BREAK_LIMIT_SEC)*100);
  if(bar){bar.style.width=pct+'%';bar.classList.toggle('over',total>BREAK_LIMIT_SEC);}
  if(used)used.textContent=Math.floor(total/60)+' daq';
}


// ============================================================
//  PRAYER TIMES (local only, Supabase ga yuborilmaydi)
// ============================================================
let prayerClockIv = null;
const PRAYER_REGION_SLUG = 'toshkent';
const PRAYER_API_URL = `https://namoz-vaqti.uz/?format=json&lang=lotin&period=today&region=${PRAYER_REGION_SLUG}`;
const TASHKENT_GEO = { lat: 41.3111, lng: 69.2797, name: 'Tashkent' };
let prayerGeo = TASHKENT_GEO;
let prayerTimesState = { date: '', list: [], next: null, source: 'fallback' };
function deg2rad(v){return v*Math.PI/180;}
function rad2deg(v){return v*180/Math.PI;}
function fixAngle(v){v%=360; return v<0?v+360:v;}
function dayOfYear(d){const s=new Date(Date.UTC(d.getFullYear(),0,0)); return Math.floor((d-s)/86400000);}
function calcSolar(date, lat, lng){
  const n = dayOfYear(date);
  const gamma = 2 * Math.PI / 365 * (n - 1 + ((date.getHours() - 12) / 24));
  const eqtime = 229.18 * (0.000075 + 0.001868*Math.cos(gamma) - 0.032077*Math.sin(gamma) - 0.014615*Math.cos(2*gamma) - 0.040849*Math.sin(2*gamma));
  const decl = 0.006918 - 0.399912*Math.cos(gamma) + 0.070257*Math.sin(gamma) - 0.006758*Math.cos(2*gamma) + 0.000907*Math.sin(2*gamma) - 0.002697*Math.cos(3*gamma) + 0.00148*Math.sin(3*gamma);
  const tz = 5;
  const noon = (720 - 4*lng - eqtime + tz*60) / 60;
  const latR = deg2rad(lat);
  function hourAngle(angleDeg){
    const angle = deg2rad(angleDeg);
    const c = (Math.sin(angle) - Math.sin(latR)*Math.sin(decl)) / (Math.cos(latR)*Math.cos(decl));
    if (c <= -1) return 180;
    if (c >= 1) return 0;
    return rad2deg(Math.acos(c));
  }
  function timeFor(angleDeg, afterNoon){
    const ha = hourAngle(angleDeg) / 15;
    return noon + (afterNoon ? ha : -ha);
  }
  function asrTime(){
    const factor = 1;
    const angle = -rad2deg(Math.atan(1 / (factor + Math.tan(Math.abs(latR - decl)))));
    return timeFor(angle, true);
  }
  return {
    fajr: timeFor(-18, false),
    sunrise: timeFor(-0.833, false),
    dhuhr: noon + (10/60),
    asr: asrTime(),
    maghrib: timeFor(-0.833, true),
    isha: timeFor(-17, true)
  };
}
function minutesToHM(v){
  let mins = Math.round(v*60);
  while(mins<0) mins += 1440;
  mins %= 1440;
  return String(Math.floor(mins/60)).padStart(2,'0') + ':' + String(mins%60).padStart(2,'0');
}
function getPrayerLabel(key){
  const labels = {
    fajr: lang==='uz' ? 'Bomdod' : 'Фаджр',
    dhuhr: lang==='uz' ? 'Peshin' : 'Зухр',
    asr: lang==='uz' ? 'Asr' : 'Аср',
    maghrib: lang==='uz' ? 'Shom' : 'Магриб',
    isha: lang==='uz' ? 'Xufton' : 'Иша'
  };
  return labels[key] || key;
}
function normalizePrayerKey(key=''){
  const map = { bomdod:'fajr', fajr:'fajr', peshin:'dhuhr', dhuhr:'dhuhr', asr:'asr', shom:'maghrib', maghrib:'maghrib', xufton:'isha', isha:'isha' };
  return map[String(key).toLowerCase()] || '';
}
function buildFallbackPrayerState(){
  const raw = calcSolar(tzNow(), TASHKENT_GEO.lat, TASHKENT_GEO.lng);
  const list = [
    { key:'fajr', time: minutesToHM(raw.fajr) },
    { key:'dhuhr', time: minutesToHM(raw.dhuhr) },
    { key:'asr', time: minutesToHM(raw.asr) },
    { key:'maghrib', time: minutesToHM(raw.maghrib) },
    { key:'isha', time: minutesToHM(raw.isha) }
  ].map(item => ({ ...item, name: getPrayerLabel(item.key) }));
  const nowMin = getTzTotalMinutes();
  const next = list.find(item => hmToMinutes(item.time) > nowMin) || list[0];
  return { date: todayISO(), list, next, source:'fallback' };
}
function getPrayerCacheKey(date=todayISO()){
  return `aloqa_prayer_times_${PRAYER_REGION_SLUG}_${date}`;
}
async function fetchPrayerSchedule(force=false){
  const date = todayISO();
  if(!force && prayerTimesState.date===date && prayerTimesState.list.length)return prayerTimesState;
  if(!force){
    try{
      const cached = JSON.parse(localStorage.getItem(getPrayerCacheKey(date)) || 'null');
      if(cached?.date===date && Array.isArray(cached.list) && cached.list.length){
        prayerTimesState = cached;
        return prayerTimesState;
      }
    }catch(e){}
  }
  try{
    const res = await fetch(PRAYER_API_URL, { headers:{ 'Accept':'application/json' }, cache:'no-store' });
    if(!res.ok) throw new Error(`Prayer API ${res.status}`);
    const data = await res.json();
    const times = data?.today?.times;
    if(!times) throw new Error('Prayer times payload empty');
    const list = [
      { key:'fajr', time: times.bomdod },
      { key:'dhuhr', time: times.peshin },
      { key:'asr', time: times.asr },
      { key:'maghrib', time: times.shom },
      { key:'isha', time: times.xufton }
    ].filter(item => item.time).map(item => ({ ...item, name: getPrayerLabel(item.key) }));
    const nextKey = normalizePrayerKey(data?.today?.next?.key);
    const next = (nextKey && list.find(item => item.key===nextKey)) || (() => {
      const nowMin = getTzTotalMinutes();
      return list.find(item => hmToMinutes(item.time) > nowMin) || list[0];
    })();
    prayerTimesState = { date, list, next, source:'namoz-vaqti.uz' };
    localStorage.setItem(getPrayerCacheKey(date), JSON.stringify(prayerTimesState));
    return prayerTimesState;
  }catch(e){
    console.warn('Prayer API fallback:', e.message);
    prayerTimesState = buildFallbackPrayerState();
    return prayerTimesState;
  }
}
async function initPrayerGeo(){
  try{
    const saved = JSON.parse(localStorage.getItem('aloqa_prayer_geo') || 'null');
    if (saved && saved.lat && saved.lng) { prayerGeo = saved; return prayerGeo; }
  }catch(e){}
  prayerGeo = { lat: 41.3111, lng: 69.2797, name: 'Tashkent' };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos)=>{
      prayerGeo = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: 'me' };
      localStorage.setItem('aloqa_prayer_geo', JSON.stringify(prayerGeo));
      updatePrayerInfo();
    }, ()=>{}, { enableHighAccuracy:false, timeout:5000, maximumAge:3600000 });
  }
  return prayerGeo;
}
function getPrayerSchedule(){
  const geo = prayerGeo || { lat: 41.3111, lng: 69.2797 };
  const now = tzNow();
  const raw = calcSolar(now, geo.lat, geo.lng);
  return [
    { key:'fajr', name: lang==='uz'?'Bomdod':'Фаджр', time: minutesToHM(raw.fajr) },
    { key:'dhuhr', name: lang==='uz'?'Peshin':'Зухр', time: minutesToHM(raw.dhuhr) },
    { key:'asr', name: lang==='uz'?'Asr':'Аср', time: minutesToHM(raw.asr) },
    { key:'maghrib', name: lang==='uz'?'Shom':'Магриб', time: minutesToHM(raw.maghrib) },
    { key:'isha', name: lang==='uz'?'Xufton':'Иша', time: minutesToHM(raw.isha) }
  ];
}
function updatePrayerInfo(){
  const list = getPrayerSchedule();
  const nowMin = getTzTotalMinutes();
  let next = list.find(x => hmToMinutes(x.time) > nowMin) || list[0];
  const npn = document.getElementById('nextPrayerName');
  const npt = document.getElementById('nextPrayerTime');
  if (npn) npn.textContent = next.name;
  if (npt) npt.textContent = next.time;
}
function startPrayerClock(){
  initPrayerGeo();
  updatePrayerInfo();
  if (prayerClockIv) clearInterval(prayerClockIv);
  prayerClockIv = setInterval(updatePrayerInfo, 60000);
}

// ============================================================
//  AUTO-END
// ============================================================
function startAutoEndCheck(){
  if(autoEndIv)clearInterval(autoEndIv);
  autoEndIv=setInterval(()=>{
    if(autoEndDone)return;
    if(!['working','lunch','break','paused'].includes(empState))return;
    if(getTzTotalMinutes()>=((AUTO_END_HOUR*60)+AUTO_END_MIN))empEnd(true);
  },30000);
  if(!autoEndDone&&['working','lunch','break','paused'].includes(empState)&&getTzTotalMinutes()>=((AUTO_END_HOUR*60)+AUTO_END_MIN))empEnd(true);
}
