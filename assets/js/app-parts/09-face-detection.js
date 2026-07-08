// ============================================================
//  FACE DETECTION — TO'LIQ QAYTA YOZILGAN
//
//  TUZATISHLAR:
//  ✅ FIX 1: isDetecting 10 sek stuck bo'lsa auto-reset
//  ✅ FIX 2: Video paused bo'lsa play() chaqirib davom etadi (skip qilmaydi)
//  ✅ FIX 3: Tab qaytganda faceHitCount reset, video play() chaqiriladi
//  ✅ FIX 4: STABLE_HIT_REQUIRED=3 (eski 5 edi — paused videoda hech to'planmaydi)
//  ✅ FIX 5: Banner faqat STABIL detection dan keyin yashiriladi
// ============================================================
let faceApiLoaded   = false;
let faceStream      = null;
let faceCheckIv     = null;
let faceCheckTimer  = null;
let faceMissCount   = 0;
let faceHitCount    = 0;
let faceUnknownCount= 0;
let lastStableFaceDetectedAt = 0;
let faceWidgetMin   = false;
let afkCurIv        = null;
let afkCountdownIv  = null;
let afkCountdownSec = AFK_GRACE_SEC;
let afkPending      = false;
let afkVoiceCount   = 0;
let afkVoiceTimer   = null;
let afkVoiceAudio   = null;
let afkWarnDismissed= false;
let faceLossStartedAt = 0;
let lastFaceBox     = null;
let livenessScore   = 0;
let myFaceDescriptor= null;
let isDetecting     = false;
// ✅ FIX 1: isDetecting stuck bo'lsa aniqlash uchun timestamp
let isDetectingStartTime = 0;

function getAfkVoiceAsset(){return null;}

function setAfkAlertVisualState(active){
  const employeePage=document.getElementById('employeePage');
  if(employeePage)employeePage.classList.toggle('afk-alert-active', !!active);
  const banner=document.getElementById('afkBanner');
  if(banner)banner.style.display=active?'block':'none';
}

function resetFaceLossState(){
  faceLossStartedAt = 0;
}

function shouldDelayFaceWarning(reason='missing'){
  if(!faceLossStartedAt)faceLossStartedAt=Date.now();
  const elapsedSec=Math.floor((Date.now()-faceLossStartedAt)/1000);
  const statusEl=document.getElementById('face_status_inline');
  const waitText=reason==='wrong_person' ? t('face_wrong_person') : t('face_searching');
  const countdownText=`${waitText} (${Math.max(0, FACE_LOSS_WARNING_DELAY_SEC-elapsedSec)}s)`;
  if(statusEl)statusEl.textContent=countdownText;
  setFaceDot(reason==='wrong_person'?'red':'yellow', countdownText);
  return elapsedSec < FACE_LOSS_WARNING_DELAY_SEC;
}

function clearAfkVoicePrompt(){
  if(afkVoiceTimer){clearTimeout(afkVoiceTimer);afkVoiceTimer=null;}
  if(afkVoiceAudio){
    afkVoiceAudio.pause();
    afkVoiceAudio.currentTime=0;
    afkVoiceAudio=null;
  }
  if(window.speechSynthesis)window.speechSynthesis.cancel();
}

function speakAfkVoiceFallback(langCode){return langCode;}
function speakAfkVoiceWarning(){afkVoiceCount=0;}

function scheduleFaceCheck(ms){
  if(faceCheckTimer){clearTimeout(faceCheckTimer);faceCheckTimer=null;}
  if(!faceControlEnabled||!faceApiLoaded||['ended','not_started','paused','lunch','break','prayer'].includes(empState))return;
  const cooldownRemaining=lastStableFaceDetectedAt
    ? Math.max(0, FACE_FOUND_COOLDOWN_INTERVAL-(Date.now()-lastStableFaceDetectedAt))
    : 0;
  const delay=cooldownRemaining>0 ? Math.max(ms, cooldownRemaining) : ms;
  faceCheckTimer=setTimeout(runFaceCheck,delay);
}

function toggleFaceWidget(){
  faceWidgetMin=!faceWidgetMin;
  const vw=document.querySelector('#faceWidget .fw-video-wrap');
  if(vw)vw.style.display=faceWidgetMin?'none':'block';
}

// ── MODEL LOADING ──────────────────────────────────────────
async function loadFaceModels(){
  if(faceApiLoaded)return true;

  for(let i=0;i<40;i++){
    if(typeof faceapi!=='undefined')break;
    await new Promise(r=>setTimeout(r,500));
  }

  if(typeof faceapi==='undefined'){
    console.error('faceapi undefined');
    return false;
  }

  // 🔴 MUHIM FIX
  try {
    if(faceapi.tf?.setBackend){
      await faceapi.tf.setBackend('cpu');
      await faceapi.tf.ready();
    }
  } catch(e){
    console.warn('Backend set error', e);
  }

  const URLS = ['./model', 'model'];

  for (const url of URLS) {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(url),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url)
      ]);
      faceApiLoaded = true;
      return true;
    } catch (e) {
      console.error('MODEL LOAD FAILED:', url, e);
    }
  }

  return false;
}
// ── START CAMERA ───────────────────────────────────────────
async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia){
    console.error('Camera API unavailable');
    return false;
  }
  if(faceStream){
    // ✅ FIX: Stream mavjud bo'lsa ham video paused bo'lishi mumkin — tekshir
    const video=document.getElementById('faceVideo');
    if(video&&video.srcObject===faceStream){
      if(video.paused){try{await video.play();}catch(e){}}
      return true;
    }
  }
  try{
    faceStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:320},height:{ideal:240},facingMode:'user'},audio:false});
    const video=document.getElementById('faceVideo');
    video.srcObject=faceStream;
    await new Promise((resolve,reject)=>{
      video.onloadedmetadata=()=>resolve();
      video.onerror=reject;
      setTimeout(resolve,3000);
    });
    try{await video.play();}catch(e){}
    const canvas=document.getElementById('faceCanvas');
    canvas.width=video.videoWidth||320;
    canvas.height=video.videoHeight||240;
    return true;
  }catch(e){
    console.error('Camera error:',e.message);
    return false;
  }
}

// ── MAIN ENTRY ─────────────────────────────────────────────
async function startFaceDetection(){
  if(!faceControlEnabled){
    updateFaceControlEmployeeUI();
    return;
  }
  if(['ended','lunch','break','prayer'].includes(empState))return;
  const statusEl=document.getElementById('face_status_inline');
  const setStatus=(txt)=>{if(statusEl)statusEl.textContent=txt;};
  setStatus('⏳ Yuklanmoqda...');
  setFaceDot('yellow','Yuklanmoqda...');
  const modelsOk=await loadFaceModels();
  if(!modelsOk){setStatus(t('face_model_error'));setFaceDot('gray',t('face_model_error'));toast('error',t('face_title'),t('face_model_error'));return;}
  const camOk=await startCamera();
  if(!camOk){setStatus('⚠️ Kamera ruxsati yoq');setFaceDot('gray','Kamera yoq');const frb=document.getElementById('faceRegBox');if(frb)frb.style.display='none';return;}
  const frb=document.getElementById('faceRegBox');
  if(frb)frb.style.display='none';
  setStatus(t('face_ready'));
  setFaceDot('green',t('face_detected'));
  if(faceCheckIv){clearInterval(faceCheckIv);faceCheckIv=null;}
  if(faceCheckTimer){clearTimeout(faceCheckTimer);faceCheckTimer=null;}
  // ✅ FIX 3: Yangi detection siklida counterlarni reset qil
  faceMissCount=0;faceHitCount=0;faceUnknownCount=0;isDetecting=false;isDetectingStartTime=0;
  runFaceCheck();
}

// ── FACE CHECK — TO'LIQ QAYTA YOZILGAN ────────────────────
async function runFaceCheck(){
  if(!faceControlEnabled)return;
  if(['lunch','break','prayer','not_started','ended'].includes(empState)){
    scheduleFaceCheck(FACE_CHECK_INTERVAL);
    return;
  }

  // ✅ FIX 1: isDetecting 10 soniyadan ortiq stuck bo'lsa majburan reset
  if(isDetecting){
    if(isDetectingStartTime>0 && Date.now()-isDetectingStartTime > 10000){
      console.warn('isDetecting stuck — reset');
      isDetecting=false;
      isDetectingStartTime=0;
    } else {
      scheduleFaceCheck(FACE_RETRY_INTERVAL);
      return; // Hali processing davom etmoqda, chiqib ket
    }
  }

  if(!faceApiLoaded){
    scheduleFaceCheck(FACE_RETRY_INTERVAL);
    return;
  }

  const video=document.getElementById('faceVideo');
  if(!video){
    scheduleFaceCheck(FACE_RETRY_INTERVAL);
    return;
  }

  // ✅ FIX 2: Video paused yoki to'xtagan bo'lsa — play() chaqir, skip qilma
  if(video.readyState < 2){
    try{ await video.play(); }catch(e){}
    scheduleFaceCheck(FACE_RETRY_INTERVAL);
    return; // Keyingi tick da qayta urinib ko'riladi
  }
  if(video.paused || video.ended){
    try{
      await video.play();
      // play() ga bir oz vaqt ber
      await new Promise(r=>setTimeout(r,200));
    }catch(e){
      console.warn('video.play() error:',e.message);
      scheduleFaceCheck(FACE_RETRY_INTERVAL);
      return;
    }
    // Agar hali readyState past bo'lsa, keyingi tickda qayta urinadi
    if(video.readyState < 2){
      scheduleFaceCheck(FACE_RETRY_INTERVAL);
      return;
    }
  }

  // Detection boshlanmoqda
  isDetecting=true;
  isDetectingStartTime=Date.now();

  try{
    const opts=new faceapi.TinyFaceDetectorOptions({inputSize:160,scoreThreshold:0.5});
    const det=await faceapi.detectSingleFace(video,opts);

    if(det && det.detection && det.detection.box &&
   det.detection.box._width > 0 &&
   det.detection.box._x !== null){
  const box = det.detection.box;

      const reason='detected';

  // Kamera oldida istalgan odam yuzi ko'rinsa ish davom etadi.
  faceHitCount++;
  faceMissCount = 0;
  faceUnknownCount = 0;
  drawFaceBox(box, true);
  updateLiveness(box);

      // ✅ FIX 4+5: STABLE_HIT_REQUIRED=3 ketma-ket detection — faqat shundan keyin AFK/banner tozalanadi
      if(faceHitCount >= STABLE_HIT_REQUIRED){
        onFaceStablyDetected(reason);
      } else {
        // Hali tasdiqlash jarayonida — faqat UI yangilanadi, AFK tozalanmaydi
        const statusEl=document.getElementById('face_status_inline');
        if(statusEl)statusEl.textContent=`🔄 Tasdiqlanyapdi... (${faceHitCount}/${STABLE_HIT_REQUIRED})`;
        setFaceDot('yellow',`Tasdiqlanyapdi ${faceHitCount}/${STABLE_HIT_REQUIRED}`);
        scheduleFaceCheck(FACE_RETRY_INTERVAL);
      }

    } else {
  // ✅ Yuz topilmadi
  faceHitCount = Math.max(0, faceHitCount - 1);
  faceMissCount++;
  faceUnknownCount=0;

  if(faceMissCount >= 3){   // <<< MUHIM
    clearFaceBox();
    lastFaceBox=null;
    livenessScore=Math.max(0,livenessScore-0.05);
    onFaceMissed();
  }else{
    setFaceDot('yellow','Yuz qidirilyapti...');
    const statusEl=document.getElementById('face_status_inline');
    if(statusEl)statusEl.textContent='🔎 Yuz qidirilyapti...';
    scheduleFaceCheck(FACE_RETRY_INTERVAL);
  }
}

  }catch(e){
    console.warn('runFaceCheck error:',e.message);
    scheduleFaceCheck(FACE_RETRY_INTERVAL);
  }finally{
    // ✅ FIX 1: Har doim finally da isDetecting ni reset qil
    isDetecting=false;
    isDetectingStartTime=0;
  }
}

function drawFaceBox(box,found){
  const canvas=document.getElementById('faceCanvas');
  if(!canvas)return;
  const video=document.getElementById('faceVideo');
  if(video&&(canvas.width!==video.videoWidth||canvas.height!==video.videoHeight)){
    canvas.width=video.videoWidth||320;
    canvas.height=video.videoHeight||240;
  }
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle=found?'#2ed573':'#ff4757';
  ctx.lineWidth=2;
  ctx.strokeRect(box.x,box.y,box.width,box.height);
}
function clearFaceBox(){
  const canvas=document.getElementById('faceCanvas');
  if(canvas){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);}
}
function updateLiveness(box){
  if(lastFaceBox){const dx=Math.abs(box.x-lastFaceBox.x)+Math.abs(box.y-lastFaceBox.y)+Math.abs(box.width-lastFaceBox.w)+Math.abs(box.height-lastFaceBox.h);livenessScore=Math.min(1,livenessScore+dx*0.02);}
  lastFaceBox={x:box.x,y:box.y,w:box.width,h:box.height};
  livenessScore=Math.max(0,livenessScore-0.003);
  const ld=document.getElementById('livenessWidgetDot');
  const lt=document.getElementById('livenessWidgetTxt');
  if(ld)ld.className='liveness-dot'+(livenessScore>0.05?' ok':'');
  if(lt)lt.textContent=livenessScore>0.05?t('face_real'):t('face_no_motion');
}

// ✅ FIX 5: Faqat STABIL detection dan keyin AFK/banner tozalanadi
function onFaceStablyDetected(reason){
  lastStableFaceDetectedAt=Date.now();
  resetFaceLossState();
  const statusEl=document.getElementById('face_status_inline');
  const name=CU?.name||'';
  let txt='✅ Tanildi: '+name;
  if(statusEl)statusEl.textContent=txt;
  setFaceDot('green','✅ '+name);
  // AFK sessiyani tugatish — faqat to'g'ri yuz bo'lsa
  if(isAfk)endAfkSession();
  afkPending=false;
  // AFK ogohlantirish modalini yashirish
  if(afkWarnShown){
    document.getElementById('m_afk_warn').classList.add('hidden');
    afkWarnShown=false;
  }
  if(afkCountdownIv){clearInterval(afkCountdownIv);afkCountdownIv=null;}
  // ✅ FIX 5: Banner faqat stabil detectiondan keyin yashiriladi
  document.getElementById('afkBanner').style.display='none';
  scheduleFaceCheck(FACE_MONITOR_INTERVAL);
}

// ── onFaceMissed ───────────────────────────────────────────
function onFaceMissed(reason='missing'){
  if(empState!=='working'){
    resetFaceLossState();
    afkPending=false;
    afkWarnDismissed=false;
    afkVoiceCount=0;
    clearAfkVoicePrompt();
    if(afkCountdownIv){clearInterval(afkCountdownIv);afkCountdownIv=null;}
    const warn=document.getElementById('m_afk_warn'); if(warn)warn.classList.add('hidden');
    setAfkAlertVisualState(false);
    afkWarnShown=false;
    return;
  }
  const statusEl=document.getElementById('face_status_inline');
  const isWrongPerson=reason==='wrong_person';
  const warningText=reason==='small_face' ? t('face_move_closer') : (isWrongPerson ? t('face_wrong_person_afk') : t('face_not_detected'));
  if(statusEl)statusEl.textContent=warningText;
  setFaceDot('red',warningText);

  setAfkAlertVisualState(true);
  if(!faceLossStartedAt)faceLossStartedAt=Date.now();
  const elapsedSec=Math.floor((Date.now()-faceLossStartedAt)/1000);
  const remainingSec=Math.max(0,AFK_GRACE_SEC-elapsedSec);
  const cd=document.getElementById('afk_countdown');if(cd)cd.textContent=fmtSecMM(remainingSec);

  if(!isAfk && !afkPending){
    afkPending=true;
    afkWarnDismissed=false;
    afkVoiceCount=0;
    const modal=document.getElementById('m_afk_warn');
    if(modal && !afkWarnDismissed){
      modal.classList.remove('hidden');
      afkWarnShown=true;
    }
    startAfkCountdown(remainingSec);
    speakAfkVoiceWarning();
  }
  scheduleFaceCheck(FACE_RETRY_INTERVAL);
}

// ── AFK SESSION ────────────────────────────────────────────
function startAfkSession(){
  if(isAfk||empState!=='working')return;
  resetFaceLossState();
  afkPending=false;
  afkWarnDismissed=false;
  afkVoiceCount=0;
  clearAfkVoicePrompt();
  isAfk=true;
  setAfkAlertVisualState(true);
  currentAfkStart=tzNow();
  afkCount++;
  afkCurSec=0;
  if(afkCurIv)clearInterval(afkCurIv);
  afkCurIv=setInterval(()=>{
    if(!isAfk){clearInterval(afkCurIv);afkCurIv=null;return;}
    afkCurSec++;
    afkSeconds++;
    breakSeconds++;
    updateAfkDisplay();
    updateBreakBar();
    saveLS();
    const tv=document.getElementById('afkTimerVal');if(tv)tv.textContent=fmtSecMM(afkCurSec);
    const atw=document.getElementById('afkTotalWidget');if(atw)atw.textContent=tf('afk_total_widget',{minutes:Math.floor(afkSeconds/60)});
    document.getElementById('afkTimer').classList.remove('hidden');
  },1000);
}

function endAfkSession(){
  if(!isAfk)return;
  resetFaceLossState();
  isAfk=false;
  afkWarnDismissed=false;
  afkVoiceCount=0;
  clearAfkVoicePrompt();
  currentAfkStart=null;
  if(afkCurIv){clearInterval(afkCurIv);afkCurIv=null;}
  if(afkCountdownIv){clearInterval(afkCountdownIv);afkCountdownIv=null;}
  document.getElementById('afkTimer').classList.add('hidden');
  setFaceDot('green',t('face_detected'));
  setAfkAlertVisualState(false);
  afkCurSec=0;
}

function startAfkCountdown(initialSec=AFK_GRACE_SEC){
  if(empState!=='working')return;
  afkCountdownSec=Math.max(0,initialSec);
  const cd=document.getElementById('afk_countdown');if(cd)cd.textContent=fmtSecMM(afkCountdownSec);
  if(afkCountdownIv)clearInterval(afkCountdownIv);
  afkCountdownIv=setInterval(()=>{
    afkCountdownSec--;
    const cd=document.getElementById('afk_countdown');if(cd)cd.textContent=fmtSecMM(afkCountdownSec);
    if(afkCountdownSec<=0){
      clearInterval(afkCountdownIv);
      afkCountdownIv=null;
      document.getElementById('m_afk_warn').classList.add('hidden');
      afkWarnShown=false;
      if(!isAfk && afkPending && empState==='working')startAfkSession();
    }
  },1000);
}

function dismissAfkWarn(){
  resetFaceLossState();
  document.getElementById('m_afk_warn').classList.add('hidden');
  afkWarnShown=false;
  afkWarnDismissed=true;
  afkVoiceCount=0;
  clearAfkVoicePrompt();
}

function pauseFaceMonitoringForBreak(){
  resetFaceLossState();
  afkPending=false;
  afkWarnDismissed=false;
  afkVoiceCount=0;
  clearAfkVoicePrompt();
  if(isAfk)endAfkSession();
  if(afkCountdownIv){clearInterval(afkCountdownIv);afkCountdownIv=null;}
  const warn=document.getElementById('m_afk_warn');
  if(warn)warn.classList.add('hidden');
  afkWarnShown=false;
  setAfkAlertVisualState(false);
  stopFaceDetection();
}

function resumeFaceMonitoringAfterBreak(){
  resetFaceLossState();
  afkPending=false;
  afkWarnDismissed=false;
  afkVoiceCount=0;
  clearAfkVoicePrompt();
  if(afkCountdownIv){clearInterval(afkCountdownIv);afkCountdownIv=null;}
  const warn=document.getElementById('m_afk_warn');
  if(warn)warn.classList.add('hidden');
  afkWarnShown=false;
  setAfkAlertVisualState(false);
  maybeStartFaceDetection();
}

// ── FACE REGISTRATION ──────────────────────────────────────
let regSamples=[];
let regCapturing=false;

function startFaceRegistration(){
  if(!faceControlEnabled){
    toast('info', t('face_control_title'), t('face_control_disabled_employee'));
    updateFaceControlEmployeeUI();
    return;
  }
  if(regCapturing)return;
  if(!faceApiLoaded){toast('warn',t('face_title'),t('face_model_wait'));return;}
  regCapturing=true;regSamples=[];updateSampleDots();
  const btn=document.getElementById('faceRegBtn');if(btn)btn.textContent='📸 0/5 tushirilmoqda...';
  captureNextSample();
}

async function captureNextSample(){
  if(!regCapturing)return;

  const video=document.getElementById('faceVideo');
  if(!video||video.readyState<2){
    toast('warn',t('face_title'),t('face_camera_unavailable'));
    regCapturing=false;
    return;
  }

  try{
    const opts=new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.5});
    const det=await faceapi.detectSingleFace(video,opts).withFaceLandmarks(true).withFaceDescriptor();

    const box = det?.detection?.box;
const descriptor = det?.descriptor;
if(box && descriptor && box._width > 0 && box._x !== null && box._y !== null){

      const area = (box.width * box.height) / (video.videoWidth * video.videoHeight);

      if(area < 0.015){
        updateQuality('Kameraga yaqinroq turing...');
        setTimeout(captureNextSample,700);
        return;
      }

      regSamples.push(Array.from(descriptor));
      updateSampleDots();
      updateQuality(regSamples.length+'/5 ✅');

      const btn=document.getElementById('faceRegBtn');
      if(btn)btn.textContent='📸 '+regSamples.length+'/5...';

      if(regSamples.length>=5){
        await saveFaceProfile();
        regCapturing=false;
        return;
      }

      setTimeout(captureNextSample,600);

    } else {
      updateQuality('Yuz aniqlanmadi — togri qarang');
      setTimeout(captureNextSample,800);
    }

  }catch(e){
    console.warn('captureNextSample error:',e.message);
    regCapturing=false;
  }
}
  
function updateSampleDots(){
  const c=document.getElementById('faceSamples');if(!c)return;
  c.innerHTML='';
  for(let i=0;i<5;i++){const d=document.createElement('div');d.className='face-sample-dot'+(i<regSamples.length?' done':'');d.textContent=i<regSamples.length?'✅':'📷';c.appendChild(d);}
}
function updateQuality(txt){const el=document.getElementById('faceQuality');if(el)el.textContent=txt;}

async function saveFaceProfile(){
  if(!CU||regSamples.length===0)return;
  const avg=new Float32Array(128);
  regSamples.forEach(d=>d.forEach((v,i)=>avg[i]+=v));
  avg.forEach((v,i)=>avg[i]=v/regSamples.length);
  const descriptor=Array.from(avg);
  try{
    await sb.from('face_profiles').upsert(
      {employee_id:CU.id, descriptor},
      {onConflict:'employee_id'}
    );
    await sb.from('employees').update({face_registered:true}).eq('id',CU.id);
    myFaceDescriptor=avg;
    const frb=document.getElementById('faceRegBox');if(frb)frb.style.display='none';
    toast('success',t('face_title'),t('face_reg_success'));
    setFaceDot('green',t('face_reg_done'));
    const btn=document.getElementById('faceRegBtn');if(btn)btn.textContent=t('face_reg_done');
    // ✅ Hit counterni reset — qayta tasdiqlash kerak
    faceHitCount=0;
    // ✅ FIX: Face profile ni qayta yukla va detection ni qayta boshlash
    await loadMyFaceProfile();
    setTimeout(()=>maybeStartFaceDetection(), 500);
  }catch(e){
  console.error('saveFaceReg xato:', e);
  console.error('xato message:', e.message);
    toast('error',t('face_title'),e.message);
  regCapturing=false;
}
}
async function loadMyFaceProfile(){
  if(!CU)return;
  try{
    const{data}=await sb.from('face_profiles').select('descriptor').eq('employee_id',CU.id).maybeSingle();
    if(data&&data.descriptor){
      myFaceDescriptor=normalizeFaceDescriptor(data.descriptor);
      const frb=document.getElementById('faceRegBox');if(frb)frb.style.display='none';
    }else{
      myFaceDescriptor=null;
      const frb=document.getElementById('faceRegBox');if(frb)frb.style.display='block';
    }
  }catch(e){console.warn('loadMyFaceProfile:',e.message);}
}

function updateAfkDisplay(){
  const d=document.getElementById('afk_display');if(d)d.textContent=fmtSec(afkSeconds);
  const c=document.getElementById('afk_cnt_lbl');if(c)c.textContent=afkCount+' '+t('afk_cnt_lbl');
  const ok=document.getElementById('afk_break_ok');if(ok)ok.classList.toggle('hidden',breakSeconds>0);
  const atw=document.getElementById('afkTotalWidget');if(atw)atw.textContent=tf('afk_total_widget',{minutes:Math.floor(afkSeconds/60)});
}

function setFaceDot(color,txt){
  const dot=document.getElementById('faceDot');const ftxt=document.getElementById('faceTxt');
  if(dot)dot.className='fw-dot '+color;if(ftxt)ftxt.textContent=txt;
}

function stopFaceDetection(){
  if(faceCheckIv){clearInterval(faceCheckIv);faceCheckIv=null;}
  if(faceCheckTimer){clearTimeout(faceCheckTimer);faceCheckTimer=null;}
  if(afkCurIv){clearInterval(afkCurIv);afkCurIv=null;}
  if(faceStream){faceStream.getTracks().forEach(t2=>t2.stop());faceStream=null;}
  // ✅ Barcha flaglarni reset
  isDetecting=false;
  isDetectingStartTime=0;
  isAfk=false;
  resetFaceLossState();
  afkPending=false;
  afkWarnDismissed=false;
  afkVoiceCount=0;
  clearAfkVoicePrompt();
  currentAfkStart=null;
  lastStableFaceDetectedAt=0;
  faceHitCount=0;
  faceMissCount=0;
  faceUnknownCount=0;
  setAfkAlertVisualState(false);
}

// ============================================================
//  FACE OVERRIDES
// ============================================================
async function loadFaceModels(){
  if(faceApiLoaded)return true;

  for(let i=0;i<40;i++){
    if(typeof faceapi!=='undefined')break;
    await new Promise(r=>setTimeout(r,500));
  }

  if(typeof faceapi==='undefined'){
    console.error('faceapi undefined');
    return false;
  }

  try{
    if(faceapi.tf?.setBackend){
      await faceapi.tf.setBackend('cpu');
      await faceapi.tf.ready();
    }
  }catch(e){
    console.warn('Backend set error', e);
  }

  const urls = ['./model', 'model'];
  for(const url of urls){
    try{
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(url)
      ]);
      faceApiLoaded = true;
      return true;
    }catch(e){
      console.warn('Model load failed:', url, e.message);
    }
  }

  return false;
}

async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia){
    console.error('Camera API unavailable');
    return false;
  }

  if(faceStream){
    const video=document.getElementById('faceVideo');
    if(video&&video.srcObject===faceStream){
      if(video.paused){try{await video.play();}catch(e){}}
      return true;
    }
  }

  try{
    faceStream=await navigator.mediaDevices.getUserMedia({
      video:{width:{ideal:320},height:{ideal:240},facingMode:'user'},
      audio:false
    });
    const video=document.getElementById('faceVideo');
    if(!video)return false;
    video.srcObject=faceStream;
    await new Promise((resolve,reject)=>{
      video.onloadedmetadata=()=>resolve();
      video.onerror=reject;
      setTimeout(resolve,3000);
    });
    try{await video.play();}catch(e){}
    const canvas=document.getElementById('faceCanvas');
    if(canvas){
      canvas.width=video.videoWidth||320;
      canvas.height=video.videoHeight||240;
    }
    return true;
  }catch(e){
    console.error('Camera error:', e.message);
    return false;
  }
}

async function startFaceDetection(){
  if(!faceControlEnabled){
    updateFaceControlEmployeeUI();
    return;
  }
  const statusEl=document.getElementById('face_status_inline');
  const setStatus=(txt)=>{if(statusEl)statusEl.textContent=txt;};
  const regBox=document.getElementById('faceRegBox');
  if(regBox)regBox.style.display='none';

  if(empState!=='working'){
    const idleText=empState==='paused'?t('paused'):(empState==='lunch'?t('st2'):(empState==='break'?t('break_state'):(empState==='prayer'?t('prayer_btn'):t('st0'))));
    setStatus(idleText);
    setFaceDot('gray', idleText);
    return;
  }

  setStatus(t('face_loading'));
  setFaceDot('yellow', t('face_loading'));

  const modelsOk=await loadFaceModels();
  if(!modelsOk){
    setStatus(t('face_model_error'));
    setFaceDot('gray', t('face_model_error'));
    toast('error', t('face_title'), t('face_model_error'));
    return;
  }

  const camOk=await startCamera();
  if(!camOk){
    setStatus(t('face_camera_error'));
    setFaceDot('gray', t('face_camera_error'));
    if(regBox)regBox.style.display='none';
    return;
  }

  setStatus(t('face_ready'));
  setFaceDot('green', t('face_detected'));

  if(faceCheckIv){clearInterval(faceCheckIv);faceCheckIv=null;}
  if(faceCheckTimer){clearTimeout(faceCheckTimer);faceCheckTimer=null;}
  faceMissCount=0;
  faceHitCount=0;
  faceUnknownCount=0;
  resetFaceLossState();
  isDetecting=false;
  isDetectingStartTime=0;
  runFaceCheck();
}

async function runFaceCheck(){
  if(!faceControlEnabled)return;
  if(['lunch','break','prayer','paused','not_started','ended'].includes(empState)){
    scheduleFaceCheck(FACE_MONITOR_INTERVAL);
    return;
  }

  if(isDetecting){
    if(isDetectingStartTime>0 && Date.now()-isDetectingStartTime > 10000){
      isDetecting=false;
      isDetectingStartTime=0;
    }else{
      scheduleFaceCheck(FACE_RETRY_INTERVAL);
      return;
    }
  }

  if(!faceApiLoaded){
    scheduleFaceCheck(FACE_RETRY_INTERVAL);
    return;
  }

  const video=document.getElementById('faceVideo');
  if(!video){
    scheduleFaceCheck(FACE_RETRY_INTERVAL);
    return;
  }

  if(video.readyState < 2 || video.paused || video.ended){
    try{
      await video.play();
      await new Promise(r=>setTimeout(r,200));
    }catch(e){
      scheduleFaceCheck(FACE_RETRY_INTERVAL);
      return;
    }
    if(video.readyState < 2){
      scheduleFaceCheck(FACE_RETRY_INTERVAL);
      return;
    }
  }

  isDetecting=true;
  isDetectingStartTime=Date.now();

  try{
    const opts=new faceapi.TinyFaceDetectorOptions({inputSize:160, scoreThreshold:0.5});
    const det=await faceapi.detectSingleFace(video,opts);
    const detection=det?.detection||det;
    const box=detection?.box;
    const boxWidth=box?.width||box?._width||0;
    const boxHeight=box?.height||box?._height||0;
    const boxX=box?.x??box?._x;
    const boxY=box?.y??box?._y;
    const videoArea=Math.max(1,(video.videoWidth||320)*(video.videoHeight||240));
    const faceAreaRatio=(boxWidth*boxHeight)/videoArea;
    const faceVisibleEnough=box&&boxWidth>0&&boxHeight>0&&boxX!==null&&boxX!==undefined&&boxY!==null&&boxY!==undefined&&faceAreaRatio>=FACE_MIN_VISIBLE_AREA;

    if(faceVisibleEnough){
      faceHitCount++;
      faceMissCount=0;
      faceUnknownCount=0;
      resetFaceLossState();
      drawFaceBox(box,true);
      updateLiveness(box);

      if(faceHitCount >= STABLE_HIT_REQUIRED){
        onFaceStablyDetected('detected');
      }else{
        const verifyText=tf('face_verifying',{current:faceHitCount,total:STABLE_HIT_REQUIRED});
        const statusEl=document.getElementById('face_status_inline');
        if(statusEl)statusEl.textContent=verifyText;
        setFaceDot('yellow', verifyText);
        scheduleFaceCheck(FACE_RETRY_INTERVAL);
      }
    }else{
      faceHitCount=Math.max(0, faceHitCount-1);
      faceUnknownCount=0;
      faceMissCount++;
      const hasSmallFace=box&&boxWidth>0&&boxHeight>0;
      const waitText=hasSmallFace?t('face_move_closer'):t('face_searching');
      if(hasSmallFace)drawFaceBox(box,false);
      else{
        clearFaceBox();
        lastFaceBox=null;
      }
      livenessScore=Math.max(0,livenessScore-0.05);
      if(faceMissCount>=FACE_MISS_REQUIRED){
        onFaceMissed(hasSmallFace?'small_face':'missing');
      }else{
        const statusEl=document.getElementById('face_status_inline');
        if(statusEl)statusEl.textContent=waitText;
        setFaceDot('yellow', waitText);
        scheduleFaceCheck(FACE_RETRY_INTERVAL);
      }
    }
  }catch(e){
    console.warn('runFaceCheck error:', e.message);
    scheduleFaceCheck(FACE_RETRY_INTERVAL);
  }finally{
    isDetecting=false;
    isDetectingStartTime=0;
  }
}

function updateLiveness(box){
  if(lastFaceBox){
    const dx=Math.abs(box.x-lastFaceBox.x)+Math.abs(box.y-lastFaceBox.y)+Math.abs(box.width-lastFaceBox.w)+Math.abs(box.height-lastFaceBox.h);
    livenessScore=Math.min(1, livenessScore+dx*0.02);
  }
  lastFaceBox={x:box.x,y:box.y,w:box.width,h:box.height};
  livenessScore=Math.max(0, livenessScore-0.003);
  const ld=document.getElementById('livenessWidgetDot');
  const lt=document.getElementById('livenessWidgetTxt');
  if(ld)ld.className='liveness-dot'+(livenessScore>0.05?' ok':'');
  if(lt)lt.textContent=livenessScore>0.05 ? t('face_real') : t('face_no_motion');
}

function onFaceStablyDetected(reason){
  lastStableFaceDetectedAt=Date.now();
  resetFaceLossState();
  const statusEl=document.getElementById('face_status_inline');
  const label=t('face_detected');
  if(statusEl)statusEl.textContent=label;
  setFaceDot('green', label);
  if(isAfk)endAfkSession();
  afkPending=false;
  afkWarnDismissed=false;
  afkVoiceCount=0;
  clearAfkVoicePrompt();
  if(afkWarnShown){
    document.getElementById('m_afk_warn').classList.add('hidden');
    afkWarnShown=false;
  }
  if(afkCountdownIv){clearInterval(afkCountdownIv);afkCountdownIv=null;}
  setAfkAlertVisualState(false);
  scheduleFaceCheck(FACE_MONITOR_INTERVAL);
}

function startFaceRegistration(){
  if(!faceControlEnabled){
    toast('info', t('face_control_title'), t('face_control_disabled_employee'));
    updateFaceControlEmployeeUI();
    return;
  }
  if(regCapturing)return;
  if(!faceApiLoaded){
    toast('warn', t('face_title'), t('face_model_wait'));
    return;
  }
  regCapturing=true;
  regSamples=[];
  updateSampleDots();
  updateQuality(tf('face_samples_count',{current:0}));
  const btn=document.getElementById('faceRegBtn');
  if(btn)btn.textContent=tf('face_reg_progress',{current:0});
  captureNextSample();
}

async function captureNextSample(){
  if(!regCapturing)return;

  const video=document.getElementById('faceVideo');
  if(!video || video.readyState<2){
    toast('warn', t('face_title'), t('face_camera_unavailable'));
    regCapturing=false;
    refreshStaticLabels();
    return;
  }

  try{
    const opts=new faceapi.TinyFaceDetectorOptions({inputSize:320, scoreThreshold:0.5});
    const det=await faceapi.detectSingleFace(video,opts).withFaceLandmarks(true).withFaceDescriptor();
    const box=det?.detection?.box;
    const descriptor=det?.descriptor;

    if(box && descriptor && box._width > 0 && box._x !== null && box._y !== null){
      const area=(box.width*box.height)/(video.videoWidth*video.videoHeight);

      if(area < 0.015){
        updateQuality(t('face_move_closer'));
        setTimeout(captureNextSample,700);
        return;
      }

      regSamples.push(Array.from(descriptor));
      updateSampleDots();
      updateQuality(tf('face_samples_count',{current:regSamples.length}));

      const btn=document.getElementById('faceRegBtn');
      if(btn)btn.textContent=tf('face_reg_progress',{current:regSamples.length});

      if(regSamples.length>=5){
        await saveFaceProfile();
        regCapturing=false;
        return;
      }

      setTimeout(captureNextSample,600);
    }else{
      updateQuality(t('face_look_straight'));
      setTimeout(captureNextSample,800);
    }
  }catch(e){
    console.warn('captureNextSample error:', e.message);
    regCapturing=false;
    refreshStaticLabels();
  }
}

function getPrayerSchedule(){
  const geo = prayerGeo || { lat: 41.3111, lng: 69.2797 };
  const now = tzNow();
  const raw = calcSolar(now, geo.lat, geo.lng);
  return [
    { key:'fajr', name: lang==='uz' ? 'Bomdod' : 'Фаджр', time: minutesToHM(raw.fajr) },
    { key:'dhuhr', name: lang==='uz' ? 'Peshin' : 'Зухр', time: minutesToHM(raw.dhuhr) },
    { key:'asr', name: lang==='uz' ? 'Asr' : 'Аср', time: minutesToHM(raw.asr) },
    { key:'maghrib', name: lang==='uz' ? 'Shom' : 'Магриб', time: minutesToHM(raw.maghrib) },
    { key:'isha', name: lang==='uz' ? 'Xufton' : 'Иша', time: minutesToHM(raw.isha) }
  ];
}

function updateSampleDots(){
  const c=document.getElementById('faceSamples');
  if(!c)return;
  c.innerHTML='';
  for(let i=0;i<5;i++){
    const d=document.createElement('div');
    d.className='face-sample-dot'+(i<regSamples.length?' done':'');
    d.textContent=i<regSamples.length?'✅':'📷';
    c.appendChild(d);
  }
}

async function saveFaceProfile(){
  if(!CU||regSamples.length===0)return;
  const avg=new Float32Array(128);
  regSamples.forEach(d=>d.forEach((v,i)=>avg[i]+=v));
  avg.forEach((v,i)=>avg[i]=v/regSamples.length);
  const normalized=normalizeFaceDescriptor(avg);
  const descriptor=Array.from(normalized||avg);

  try{
    await sb.from('face_profiles').upsert({employee_id:CU.id, descriptor},{onConflict:'employee_id'});
    await sb.from('employees').update({face_registered:true}).eq('id',CU.id);
    myFaceDescriptor=normalized||avg;
    const frb=document.getElementById('faceRegBox');
    if(frb)frb.style.display='none';
    toast('success',t('face_title'),t('face_reg_done'));
    setFaceDot('green',t('face_reg_done'));
    const btn=document.getElementById('faceRegBtn');
    if(btn)btn.textContent=t('face_reg_done');
    faceHitCount=0;
    await loadMyFaceProfile();
    setTimeout(()=>maybeStartFaceDetection(),500);
  }catch(e){
    console.error('saveFaceReg xato:', e);
    toast('error',t('face_title'),e.message);
    regCapturing=false;
    refreshStaticLabels();
  }
}

// ============================================================
