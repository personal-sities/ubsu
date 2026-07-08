//  EXPORT
// ============================================================
function exportExcel(){
  if(!monthlyData||monthlyData.length===0){toast('warn',t('export_title'),t('export_load_monthly_first'));return;}
  if(typeof XLSX==='undefined'){toast('warn',t('export_title'),t('export_excel_wait'));return;}
  const month=document.getElementById('fmonth').value||curM();
  const headers=['#',t('mt_date'),t('mt1'),t('mt2'),t('mt_worked'),t('mt_lunch_start'),t('mt_lunch_end'),t('mt_end')];
  const rows=monthlyData.map((d,i)=>[i+1,d.date,d.name,d.start,d.hours,d.lunchStart,d.lunchEnd,d.end]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols']=headers.map(()=>({wch:18}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,month+' '+t('report_sheet'));
  XLSX.writeFile(wb,'AloqaPro_'+month+'_attendance.xlsx');
  toast('success',t('export_title'),'Excel: '+t('export_downloaded'));
}
function exportPDF(){
  if(!monthlyData||monthlyData.length===0){toast('warn',t('export_title'),t('export_load_monthly_first'));return;}
  if(typeof window.jspdf==='undefined'){toast('warn',t('export_title'),t('export_pdf_wait'));return;}
  const month=document.getElementById('fmonth').value||curM();
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  doc.setFontSize(14);
  doc.text(`AloqaPro — ${t('report_title')}: `+month,14,14);
  doc.setFontSize(10);
  doc.text('Sana: '+new Date().toLocaleDateString(),14,22);
  const headers=[['#',t('mt_date'),t('mt1'),t('mt2'),t('mt_worked'),t('mt_lunch_start'),t('mt_lunch_end'),t('mt_end')]];
  const rows=monthlyData.map((d,i)=>[i+1,d.date,d.name,d.start,d.hours,d.lunchStart,d.lunchEnd,d.end]);
  doc.autoTable({head:headers,body:rows,startY:28,styles:{fontSize:9,cellPadding:2},headStyles:{fillColor:[11,78,162],textColor:[255,255,255],fontStyle:'bold'},alternateRowStyles:{fillColor:[245,248,252]},margin:{left:14,right:14}});
  doc.save('AloqaPro_'+month+'_attendance.pdf');
  toast('success',t('export_title'),'PDF: '+t('export_downloaded'));
}

// ============================================================
//  EMPLOYEE STATE
// ============================================================
let empState = 'not_started';
let wStart = null, wAccum = 0;
let lStart = null, lAccum = 0;
let wIv = null, lIv = null;
let afkSeconds = 0;
let afkCount = 0;
let afkCurSec = 0;
let afkIv = null;
let currentAfkStart = null;
let afkWarnShown = false;
let isAfk = false;
let breakSeconds = 0;
let prayerAccum = 0;
let prayerStart = null;
let pIv = null;
let autoEndIv = null;
let autoEndDone = false;
let platformPauseTimer = null;
let pendingAutoEndSave = false;

function todayBreakSec(){return breakSeconds;}

function getLS(){return JSON.parse(localStorage.getItem('aloqa_emp_state')||'null');}
function normalizeAttendanceTime(v){
  if(!v||v==='-')return null;
  const parts=String(v).split(':');
  if(parts.length<2)return null;
  const h=Math.trunc(Number(parts[0])),m=Math.trunc(Number(parts[1])),s=parts.length>2?Math.trunc(Number(parts[2])):0;
  if(!Number.isFinite(h)||!Number.isFinite(m)||!Number.isFinite(s))return null;
  if(h<0||h>23||m<0||m>59||s<0||s>59)return null;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function getAttendanceTime(ss, exactKey, displayKey){
  return normalizeAttendanceTime(ss?.[exactKey]) || normalizeAttendanceTime(ss?.[displayKey]);
}
function rememberAttendanceTime(displayKey, exactKey, date){
  const display=fmtHM(date);
  st(displayKey,display);
  const ss=getLS()||{};
  ss[displayKey]=display;
  ss[exactKey]=fmtHMS(date);
  localStorage.setItem('aloqa_emp_state',JSON.stringify(ss));
}
async function upsertAttendance(payload,{showError=false}={}){
  const {error}=await sb.from('attendance').upsert(payload,{onConflict:'employee_id,work_date'});
  if(error){
    console.warn('attendance save:', error.message || error);
    if(showError)toast('error',t('error_title'),error.message||t('attendance_load_error'));
    return false;
  }
  return true;
}
function saveLS(){
  const ss=getLS()||{};
  const data={date:todayISO(),state:empState,wAccum,lAccum,prayerAccum,afkSeconds,afkCount,breakSeconds,wStartISO:wStart?wStart.toISOString():null,lStartISO:lStart?lStart.toISOString():null,prayerStartISO:prayerStart?prayerStart.toISOString():null,afkStartISO:currentAfkStart?currentAfkStart.toISOString():null,i_s:document.getElementById('i_s')?.textContent||'-',i_e:document.getElementById('i_e')?.textContent||'-',i_ls:document.getElementById('i_ls')?.textContent||'-',i_le:document.getElementById('i_le')?.textContent||'-',i_ps:document.getElementById('i_ps')?.textContent||'-',i_pe:document.getElementById('i_pe')?.textContent||'-',startTime:getAttendanceTime(ss,'startTime','i_s'),endTime:getAttendanceTime(ss,'endTime','i_e'),lunchStartTime:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunchEndTime:getAttendanceTime(ss,'lunchEndTime','i_le'),prayerStartTime:getAttendanceTime(ss,'prayerStartTime','i_ps'),prayerEndTime:getAttendanceTime(ss,'prayerEndTime','i_pe'),lateMin:ss.lateMin||0,autoEndDone:autoEndDone||false,lastSavedISO:tzNow().toISOString()};
  localStorage.setItem('aloqa_emp_state',JSON.stringify(data));
}
function getTodayAutoEndDate(){
  const hh=String(AUTO_END_HOUR).padStart(2,'0');
  const mm=String(AUTO_END_MIN).padStart(2,'0');
  return new Date(`${todayISO()}T${hh}:${mm}:00+05:00`);
}
async function restoreLS(){
  const ss=getLS();
  if(!ss||ss.date!==todayISO()){localStorage.removeItem('aloqa_emp_state');updateEmpBtns();return false;}
  empState=ss.state||'not_started';wAccum=ss.wAccum||0;lAccum=ss.lAccum||0;prayerAccum=ss.prayerAccum||0;afkSeconds=ss.afkSeconds||0;afkCount=ss.afkCount||0;breakSeconds=ss.breakSeconds||0;autoEndDone=ss.autoEndDone||false;
  if(ss.wStartISO)wStart=new Date(ss.wStartISO);
  if(ss.lStartISO)lStart=new Date(ss.lStartISO);
  if(ss.prayerStartISO)prayerStart=new Date(ss.prayerStartISO);
  if(!autoEndDone&&['working','lunch','paused','prayer'].includes(empState)){
    const autoEndAt=getTodayAutoEndDate();
    if(tzNow()>=autoEndAt){
      let canAutoFinish=false;
      try{
        canAutoFinish=await canFinishWorkByAmoCrmTasks({auto:true});
      }catch(e){
        console.warn('auto-end restore task check:', e.message||e);
      }
      if(canAutoFinish){
        if(empState==='working'&&wStart)wAccum+=Math.max(0,Math.floor((autoEndAt-wStart)/1000));
        if(empState==='lunch'&&lStart)lAccum+=Math.max(0,Math.floor((autoEndAt-lStart)/1000));
        if(empState==='prayer'&&prayerStart)prayerAccum+=Math.max(0,Math.floor((autoEndAt-prayerStart)/1000));
        wStart=null;lStart=null;prayerStart=null;empState='ended';autoEndDone=true;
        ss.state='ended';ss.wAccum=wAccum;ss.lAccum=lAccum;ss.prayerAccum=prayerAccum;
        ss.wStartISO=null;ss.lStartISO=null;ss.prayerStartISO=null;ss.afkStartISO=null;
        ss.i_e=ss.i_e&&ss.i_e!=='-'?ss.i_e:fmtHM(autoEndAt);
        ss.endTime=ss.endTime||fmtHMS(autoEndAt);
        ss.autoEndDone=true;ss.lastSavedISO=tzNow().toISOString();
        localStorage.setItem('aloqa_emp_state',JSON.stringify(ss));
        pendingAutoEndSave=true;
      }
    }
  }
  if(ss.afkStartISO&&empState==='working'){currentAfkStart=new Date(ss.afkStartISO);isAfk=true;const elapsed=Math.floor((tzNow()-currentAfkStart)/1000);if(elapsed>0){afkSeconds+=elapsed;breakSeconds+=elapsed;}currentAfkStart=null;isAfk=false;}
  st('i_s',ss.i_s||'-');st('i_e',ss.i_e||'-');st('i_ls',ss.i_ls||'-');st('i_le',ss.i_le||'-');st('i_ps',ss.i_ps||'-');st('i_pe',ss.i_pe||'-');
  const lt=document.getElementById('e_ltag');if(lt&&ss.lateMin!==undefined)lt.textContent=t('lt_pre')+' '+ss.lateMin+' '+t('lt_u');
  const displayWork=empState==='working'&&wStart?wAccum+Math.max(0,Math.floor((tzNow()-wStart)/1000)):wAccum;
  setTV(displayWork,'tw');setTV(lAccum,'tl');setTV(prayerAccum,'tp');updateAfkDisplay();updateBreakBar();updatePrayerInfo();updateEmpBtns();updateEmpStatusTag();
  if(empState==='working')startWT();
  if(empState==='lunch')startLT();
  if(empState==='prayer')startPT();
  return true;
}

// ============================================================
//  EMPLOYEE INIT
// ============================================================
async function initEmp(){
  const restored=await restoreLS();setEmpMonth();loadHist();updateDates();
  document.getElementById('m_welcome').classList.remove('hidden');
  const mt=document.getElementById('e_mtag');if(mt)mt.textContent=curM();
  await loadFaceControlSettings();
  startFaceControlPolling();
  maybeStartFaceDetection();startAutoEndCheck();startPrayerClock();
  if(pendingAutoEndSave){
    pendingAutoEndSave=false;
    saveAtt(true).catch(e=>console.warn('auto-end restore save:',e.message||e));
  }
  if(restored&&empState==='ended')saveAtt(autoEndDone).catch(e=>console.warn('attendance restore save:',e.message||e));
  else if(restored&&empState!=='not_started')savePartial().catch(e=>console.warn('attendance restore save:',e.message||e));
  loadTodayLunchPlan().then(()=>ensureLunchShiftPrompt());
  if(Notification.permission==='granted'){scheduleReminders();}
  subscribeEmployeeRealtime();
  loadNotificationsEmp(false);
  empNavTab('work');
}
function closeWelcome(){document.getElementById('m_welcome').classList.add('hidden');}

// ============================================================
//  EMPLOYEE ACTIONS
// ============================================================
async function empStart(){
  if(empState!=='not_started')return;
  const access=await checkRegionAccess('employee');
  if(!access.ok){
    showIPBlock(access.value, access.title, access.message);
    await sb.auth.signOut();
    return;
  }
  wStart=tzNow();empState='working';
  rememberAttendanceTime('i_s','startTime',wStart);
  const lm=computeLateMinutesFromDate(wStart);
  const el=document.getElementById('e_ltag');if(el)el.textContent=t('lt_pre')+' '+lm+' '+t('lt_u');
  const ss=getLS()||{};ss.lateMin=lm;localStorage.setItem('aloqa_emp_state',JSON.stringify(ss));
  await loadFaceControlSettings();
  updateEmpBtns();updateEmpStatusTag();startWT();saveLS();maybeStartFaceDetection();
  if(!(await savePartial(true)))return;
  toast('success',t('bs'),t('work_started_success'));
}
async function empLunch(){
  if(empState==='lunch'){await empBackLunch();return;}
  if(empState!=='working')return;
  lStart=tzNow();if(wStart)wAccum+=Math.floor((lStart-wStart)/1000);wStart=null;
  empState='lunch';rememberAttendanceTime('i_ls','lunchStartTime',lStart);stopWT();pauseFaceMonitoringForBreak();updateEmpBtns();updateEmpStatusTag();startLT();saveLS();
  if(!(await savePartial(true)))return;
  toast('info',t('lunch_title'),`${t('lunch_rest_msg')} 🍽️`);
}
async function empBackLunch(){
  if(empState!=='lunch')return;
  const now=tzNow();if(lStart)lAccum+=Math.floor((now-lStart)/1000);lStart=null;
  rememberAttendanceTime('i_le','lunchEndTime',now);empState='working';wStart=now;stopLT();resumeFaceMonitoringAfterBreak();updateEmpBtns();updateEmpStatusTag();startWT();saveLS();
  if(!(await savePartial(true)))return;
  toast('success',t('lunch_title'),`${t('work_continues')} 💼`);
}
async function empPrayer(){
  if(empState==='prayer'){await empBackPrayer();return;}
  if(empState!=='working')return;
  prayerStart=tzNow();
  if(wStart)wAccum+=Math.floor((prayerStart-wStart)/1000);
  wStart=null;
  empState='prayer';
  rememberAttendanceTime('i_ps','prayerStartTime',prayerStart);
  stopWT();
  pauseFaceMonitoringForBreak();
  updateEmpBtns();updateEmpStatusTag();startPT();saveLS();
  if(!(await savePartial(true)))return;
  toast('info',t('prayer_btn'),t('prayer_started_success'));
}
async function empBackPrayer(){
  if(empState!=='prayer')return;
  const now=tzNow();
  if(prayerStart)prayerAccum+=Math.floor((now-prayerStart)/1000);
  prayerStart=null;
  rememberAttendanceTime('i_pe','prayerEndTime',now);
  empState='working';
  wStart=now;
  stopPT();
  resumeFaceMonitoringAfterBreak();
  updateEmpBtns();updateEmpStatusTag();startWT();saveLS();
  if(!(await savePartial(true)))return;
  toast('success',t('prayer_btn'),`${t('work_continues')} 💼`);
}
async function empContinue(){
  if(empState!=='paused')return;
  empState='working';
  wStart=tzNow();
  document.getElementById('bc').classList.add('hidden');
  updateEmpBtns();updateEmpStatusTag();startWT();saveLS();maybeStartFaceDetection();
  if(!(await savePartial(true)))return;
}
function pauseWorkForPlatformExit({saveRemote=false}={}){
  if(!CU||CU.role!=='employee'||empState!=='working')return false;
  const now=tzNow();
  if(wStart)wAccum+=Math.floor((now-wStart)/1000);
  wStart=null;
  empState='paused';
  stopWT();
  setTV(wAccum,'tw');
  if(isAfk)endAfkSession();
  afkPending=false;
  afkWarnShown=false;
  afkWarnDismissed=false;
  afkVoiceCount=0;
  clearAfkVoicePrompt();
  if(afkCountdownIv){clearInterval(afkCountdownIv);afkCountdownIv=null;}
  const warn=document.getElementById('m_afk_warn');
  if(warn)warn.classList.add('hidden');
  setAfkAlertVisualState(false);
  stopFaceDetection();
  const bc=document.getElementById('bc');
  if(bc)bc.classList.remove('hidden');
  updateEmpBtns();
  updateEmpStatusTag();
  saveLS();
  if(saveRemote)savePartial().catch(e=>console.warn('platform pause save:',e.message||e));
  return true;
}
function syncWorkWhileAway({saveRemote=false}={}){
  if(!CU||CU.role!=='employee'||empState==='not_started')return;
  saveLS();
  if(saveRemote&&empState!=='ended')savePartial().catch(e=>console.warn('platform sync save:',e.message||e));
}
async function empEnd(auto=false){
  if(!['working','lunch','paused','prayer'].includes(empState))return;
  try{
    const canFinish=await canFinishWorkByAmoCrmTasks({auto});
    if(!canFinish)return;
  }catch(e){
    console.warn('finish task check:', e.message||e);
    if(!auto)toast('error', t('error_title'), e.message || t('amocrm_stats_error'), 5000);
    return;
  }
  const now=tzNow();
  if(empState==='working'&&wStart)wAccum+=Math.floor((now-wStart)/1000);
  if(empState==='lunch'&&lStart)lAccum+=Math.floor((now-lStart)/1000);
  if(empState==='prayer'&&prayerStart)prayerAccum+=Math.floor((now-prayerStart)/1000);
  wStart=null;lStart=null;prayerStart=null;empState='ended';rememberAttendanceTime('i_e','endTime',now);
  stopWT();stopLT();stopPT();document.getElementById('bc').classList.add('hidden');
  setTV(wAccum,'tw');setTV(lAccum,'tl');setTV(prayerAccum,'tp');updateEmpBtns();updateEmpStatusTag();stopFaceDetection();
  if(auto)autoEndDone=true;
  saveLS();
  if(!(await saveAtt(auto,true)))return;
  if(auto){document.getElementById('m_auto_end').classList.remove('hidden');document.getElementById('autoEndBanner').style.display='block';setTimeout(()=>document.getElementById('autoEndBanner').style.display='none',5000);}
  else toast('success',t('be'),t('day_finished_success'));
}
async function saveAtt(autoEnded=false,showError=false){
  if(!CU)return false;
  const today=todayISO();const ss=getLS()||{};const lm=ss.lateMin||0;
  const startTime=getAttendanceTime(ss,'startTime','i_s');
  const endTime=getAttendanceTime(ss,'endTime','i_e');
  const startHM=startTime?startTime.substring(0,5):null;
  const endHM=endTime?endTime.substring(0,5):null;
  const payload={employee_id:CU.id,work_date:today,start_time:startTime,end_time:endTime,lunch_start:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunch_end:getAttendanceTime(ss,'lunchEndTime','i_le'),work_seconds:wAccum,lunch_seconds:lAccum,afk_seconds:getPenaltyAfkSeconds(afkSeconds),afk_count:afkCount,late_minutes:lm,status:computeStatusByTimes(startHM,endHM,lm,wAccum),auto_ended:autoEnded};
  if(!(await upsertAttendance(payload,{showError})))return false;
  loadHist();
  return true;
}
async function savePartial(showError=false){
  if(!CU||empState==='not_started')return false;
  const today=todayISO();const ss=getLS()||{};const lm=ss.lateMin||0;
  let cw=wAccum;if(empState==='working'&&wStart)cw+=Math.floor((tzNow()-wStart)/1000);
  let cl=lAccum;if(empState==='lunch'&&lStart)cl+=Math.floor((tzNow()-lStart)/1000);
  let afkNow=afkSeconds;
  const startTime=getAttendanceTime(ss,'startTime','i_s');
  const endTime=getAttendanceTime(ss,'endTime','i_e');
  const startHM=startTime?startTime.substring(0,5):null;
  const endHM=endTime?endTime.substring(0,5):null;
  const payload={employee_id:CU.id,work_date:today,start_time:startTime,end_time:endTime,lunch_start:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunch_end:getAttendanceTime(ss,'lunchEndTime','i_le'),work_seconds:cw,lunch_seconds:cl,afk_seconds:getPenaltyAfkSeconds(afkNow),afk_count:afkCount,late_minutes:lm,status:computeStatusByTimes(startHM,endHM,lm,cw),auto_ended:false};
  return upsertAttendance(payload,{showError});
}

// ============================================================
