//  EMP UI HELPERS
// ============================================================
function updateEmpBtns(){
  const bsE=document.getElementById('bs'),blE=document.getElementById('bl'),bpE=document.getElementById('bp'),beE=document.getElementById('be'),bcE=document.getElementById('bc');
  const dis=(b,d)=>{if(b)b.disabled=d;};
  if(bcE)bcE.classList.toggle('hidden',empState!=='paused');
  if(empState==='not_started'){dis(bsE,false);dis(blE,true);dis(bpE,true);dis(beE,true);if(blE){blE.textContent=t('bl');blE.onclick=empLunch;} if(bpE){bpE.textContent=t('prayer_btn');bpE.onclick=empPrayer;}}
  else if(empState==='working'){dis(bsE,true);dis(blE,false);dis(bpE,false);dis(beE,false);if(blE){blE.textContent=t('bl');blE.onclick=empLunch;} if(bpE){bpE.textContent=t('prayer_btn');bpE.onclick=empPrayer;}}
  else if(empState==='lunch'){dis(bsE,true);dis(blE,false);dis(bpE,true);dis(beE,true);if(blE){blE.textContent=t('bb');blE.onclick=empBackLunch;} if(bpE){bpE.textContent=t('prayer_btn');bpE.onclick=empPrayer;}}
  else if(empState==='prayer'){dis(bsE,true);dis(blE,true);dis(bpE,false);dis(beE,true);if(bpE){bpE.textContent=t('prayer_back');bpE.onclick=empBackPrayer;}}
  else if(empState==='paused'||empState==='ended'){dis(bsE,true);dis(blE,true);dis(bpE,true);dis(beE,true);}
}
function updateEmpStatusTag(){
  const map={not_started:t('st0'),working:t('st1'),lunch:t('st2'),prayer:t('prayer_btn'),paused:t('paused'),ended:t('st4')};
  const el=document.getElementById('e_stag');if(el)el.textContent=t('st_pre')+' '+(map[empState]||'');
}
function setEmpMonth(){document.getElementById('e_month').value=curM();loadHist();}

function getEmployeeMonthlyLateCount(recs,m){
  const lateDates=new Set((recs||[])
    .filter(r=>Number(r.late_minutes||0)>0&&r.work_date)
    .map(r=>r.work_date));
  if(m===curM()){
    const ss=typeof getLS==='function' ? getLS() : null;
    if(Number(ss?.lateMin||0)>0)lateDates.add(todayISO());
  }
  return lateDates.size;
}

async function loadHist(){
  if(!CU)return;
  const m=document.getElementById('e_month').value||curM();
  const[y,mo]=m.split('-').map(Number);const dim=new Date(y,mo,0).getDate();
  const{data:recs}=await sb.from('attendance').select('*').eq('employee_id',CU.id).gte('work_date',`${m}-01`).lte('work_date',`${m}-${String(dim).padStart(2,'0')}`).order('work_date');
  const tbody=document.getElementById('hbody');tbody.innerHTML='';
  let lc=0,totalAfkSec=0;
  if(!recs||recs.length===0){tbody.innerHTML=`<tr><td colspan="11" style="text-align:center;color:var(--text3);padding:20px">${t('no_data')}</td></tr>`;st('e_lc',''+getEmployeeMonthlyLateCount([],m));st('e_afk_total','0 '+t('daqiqa'));return;}
  recs.forEach((r,i)=>{
    totalAfkSec+=r.afk_seconds||0;
    const wh=Math.floor((r.work_seconds||0)/3600),wm=Math.floor(((r.work_seconds||0)%3600)/60);
    const lh=Math.floor((r.lunch_seconds||0)/3600),lm2=Math.floor(((r.lunch_seconds||0)%3600)/60);
    const afkMin=Math.floor((r.afk_seconds||0)/60);
    const status=computeStatusByTimes(
      r.start_time?r.start_time.substring(0,5):null,
      r.end_time?r.end_time.substring(0,5):null,
      r.late_minutes||0,
      r.work_seconds||0
    );
    let bdg='';
    if(status==='keldi')bdg=`<span class="badge bg">${t('b_came')}</span>`;
    else if(status==='kechikkan')bdg=`<span class="badge by">${t('b_late')}</span>`;
    else if(status==='yarim_kun')bdg=`<span class="badge bauto">${t('b_half')}</span>`;
    else bdg=`<span class="badge br">${t('b_abs')}</span>`;
    if(r.auto_ended)bdg+=` <span class="badge bauto" style="font-size:10px">⚙️ ${t('auto_label')}</span>`;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${i+1}</td><td style="font-family:var(--mono)">${r.work_date}</td><td style="font-family:var(--mono)">${r.start_time?r.start_time.substring(0,5):'-'}</td><td>${r.lunch_start?r.lunch_start.substring(0,5):'-'}</td><td>${r.lunch_end?r.lunch_end.substring(0,5):'-'}</td><td>${r.end_time?r.end_time.substring(0,5):'-'}</td><td>${r.late_minutes?r.late_minutes+' '+t('daq'):'-'}</td><td style="font-family:var(--mono)">${wh} ${t('soat')} ${wm} ${t('daqiqa')}</td><td>${lh} ${t('soat')} ${lm2} ${t('daqiqa')}</td><td style="color:${afkMin>0?'var(--danger)':'inherit'};font-family:var(--mono)">${afkMin>0?afkMin+' '+t('daq'):'—'}</td><td>${bdg}</td>`;
    tbody.appendChild(tr);
  });
  lc=getEmployeeMonthlyLateCount(recs,m);
  st('e_lc',''+lc);st('e_afk_total',Math.floor(totalAfkSec/60)+' '+t('daqiqa'));
}

// ============================================================
//  INIT
// ============================================================
(async function(){
  applyTheme(localStorage.getItem('aloqa_theme')||'light');
  userPublicIP=await getUserIP();
  const myIPEl=document.getElementById('ipb_val');if(myIPEl)myIPEl.textContent=userPublicIP||'—';

  try{
    const { data: sessionData } = await sb.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if(uid){
      const { data: adm } = await sb.from('admins').select('*').eq('user_id', uid).maybeSingle();
      if(adm){
        CU = {...adm, role:'admin'};
      }else{
        const { data: emp } = await sb.from('employees').select('*').eq('user_id', uid).maybeSingle();
        if(emp){
          const access=await checkRegionAccess('employee');
          if(!access.ok){showIPBlock(access.value, access.title, access.message);return;}
          CU = {...emp, role:'employee'};
        }
      }
    }
  }catch(e){
    console.warn('session restore error:',e);
    CU = null;
  }
  if(CU)localStorage.setItem('aloqa_u', JSON.stringify(CU));
  else localStorage.removeItem('aloqa_u');

  showPage(CU?(CU.role==='admin'?'admin':'employee'):'login');
  sb.auth.onAuthStateChange((event) => {
    if(event==='SIGNED_OUT'){
      CU = null;
      localStorage.removeItem('aloqa_u');
      stopRealtimeSubscriptions();
      showPage('login');
    }
  });

  const loginForm = document.getElementById('loginForm');
  if(loginForm){
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      await doLogin();
    });
  }

  window.addEventListener('pagehide',()=>{syncWorkWhileAway({saveRemote:true});});
  window.addEventListener('beforeunload',()=>{syncWorkWhileAway({saveRemote:true});});
  window.addEventListener('blur',()=>{
    if(platformPauseTimer)clearTimeout(platformPauseTimer);
    platformPauseTimer=setTimeout(()=>{
      if(document.hidden||!document.hasFocus())syncWorkWhileAway({saveRemote:true});
    },1200);
  });
  window.addEventListener('focus',()=>{
    if(platformPauseTimer){clearTimeout(platformPauseTimer);platformPauseTimer=null;}
  });

  // ✅ FIX 3: Tab qaytganda — faceHitCount reset, video qayta yoqiladi
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      syncWorkWhileAway({saveRemote:true});
      return;
    }
    syncWorkWhileAway();
    if(!document.hidden && CU && CU.role==='employee'){ loadNotificationsEmp(true); }
    if(!document.hidden && CU && CU.role==='employee' && empState==='working' && faceControlEnabled){
      if(!faceStream){
        // Stream yo'q — to'liq qayta boshlash
        maybeStartFaceDetection();
      } else {
        // Stream bor — faqat video ni qayta yoqish va counterlarni reset
        const video=document.getElementById('faceVideo');
        if(video && video.paused){
          try{ video.play(); }catch(e){}
        }
        // ✅ MUHIM: Tab qaytganda ketma-ket detection yangilansin
        faceHitCount=0;
        faceMissCount=0;
        faceUnknownCount=0;
        isDetecting=false;
        isDetectingStartTime=0;
        scheduleFaceCheck(FACE_RETRY_INTERVAL);
      }
    }else if(!document.hidden && CU && CU.role==='employee' && empState==='working'){
      updateFaceControlEmployeeUI();
    }
  });

async function initPrayerGeo(){
  prayerGeo = TASHKENT_GEO;
  return prayerGeo;
}

function getPrayerSchedule(){
  return prayerTimesState.list.length ? prayerTimesState.list : buildFallbackPrayerState().list;
}

async function updatePrayerInfo(){
  const state = await fetchPrayerSchedule();
  const next = state.next || state.list[0];
  const npn = document.getElementById('nextPrayerName');
  const npt = document.getElementById('nextPrayerTime');
  if (npn) npn.textContent = next ? next.name : '—';
  if (npt) npt.textContent = next ? next.time : '--:--';
}

async function startPrayerClock(){
  await initPrayerGeo();
  await updatePrayerInfo();
  if (prayerClockIv) clearInterval(prayerClockIv);
  prayerClockIv = setInterval(()=>{ updatePrayerInfo().catch(()=>{}); }, 60000);
}
})();
