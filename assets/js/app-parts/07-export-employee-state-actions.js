//  EXPORT
// ============================================================
function exportExcel(){
  if(!monthlyData||monthlyData.length===0){toast('warn',t('export_title'),t('export_load_monthly_first'));return;}
  if(typeof XLSX==='undefined'){toast('warn',t('export_title'),t('export_excel_wait'));return;}
  const month=document.getElementById('fmonth').value||curM();
  const headers=['#',t('mt_date'),t('mt1'),t('mt2'),t('mt_worked'),t('mt_lunch_start'),t('mt_lunch_end'),t('extra_break'),t('mt_end')];
  const rows=monthlyData.map((d,i)=>[i+1,d.date,d.name,d.start,d.hours,d.lunchStart,d.lunchEnd,d.breakTime||'-',d.end]);
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
  const headers=[['#',t('mt_date'),t('mt1'),t('mt2'),t('mt_worked'),t('mt_lunch_start'),t('mt_lunch_end'),t('extra_break'),t('mt_end')]];
  const rows=monthlyData.map((d,i)=>[i+1,d.date,d.name,d.start,d.hours,d.lunchStart,d.lunchEnd,d.breakTime||'-',d.end]);
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
let extraBreakStart = null, extraBreakAccum = 0;
let extraBreakIv = null;
let prayerAccum = 0;
let prayerStart = null;
let pIv = null;
let autoEndIv = null;
let autoEndDone = false;
let platformPauseTimer = null;
let pendingAutoEndSave = false;
let lunchActionLocked = false;
let lunchActionUnlockTimer = null;
let attendanceSaveQueue = Promise.resolve();

const LEGACY_EMP_STATE_KEY = 'aloqa_emp_state';
const EMP_STATE_KEY_PREFIX = `${LEGACY_EMP_STATE_KEY}:`;
const LUNCH_ACTION_COOLDOWN_MS = 1200;

function todayBreakSec(){return breakSeconds;}
function currentExtraBreakSeconds(){
  let total=extraBreakAccum||0;
  if(empState==='break'&&extraBreakStart)total+=Math.max(0,Math.floor((tzNow()-extraBreakStart)/1000));
  return total;
}
function extraBreakOverSeconds(total=currentExtraBreakSeconds()){
  return Math.max(0,Math.floor(total||0)-BREAK_LIMIT_SEC);
}

function readLocalState(key){
  if(!key)return null;
  try{return JSON.parse(localStorage.getItem(key)||'null');}
  catch(e){console.warn('employee state parse:',e.message||e);localStorage.removeItem(key);return null;}
}
function getEmployeeStateKey(employeeId=CU?.id){
  return employeeId ? `${EMP_STATE_KEY_PREFIX}${employeeId}` : null;
}
function getLS(){return readLocalState(getEmployeeStateKey());}
function setLS(data){
  const key=getEmployeeStateKey();
  if(!key||!data)return;
  localStorage.setItem(key,JSON.stringify({...data,employeeId:CU.id}));
}
function removeLS(){
  const key=getEmployeeStateKey();
  if(key)localStorage.removeItem(key);
}
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
  setLS(ss);
}
async function upsertAttendance(payload,{showError=false}={}){
  const saveOperation=attendanceSaveQueue.catch(()=>{}).then(async()=>{
    const {error}=await sb.from('attendance').upsert(payload,{onConflict:'employee_id,work_date'});
    if(error){
      console.warn('attendance save:', error.message || error);
      if(showError)toast('error',t('error_title'),error.message||t('attendance_load_error'));
      return false;
    }
    return true;
  });
  attendanceSaveQueue=saveOperation.then(()=>undefined,()=>undefined);
  return saveOperation;
}
function saveLS(){
  const ss=getLS()||{};
  const data={date:todayISO(),state:empState,wAccum,lAccum,extraBreakAccum,prayerAccum,afkSeconds,afkCount,breakSeconds,wStartISO:wStart?wStart.toISOString():null,lStartISO:lStart?lStart.toISOString():null,extraBreakStartISO:extraBreakStart?extraBreakStart.toISOString():null,prayerStartISO:prayerStart?prayerStart.toISOString():null,afkStartISO:currentAfkStart?currentAfkStart.toISOString():null,i_s:document.getElementById('i_s')?.textContent||'-',i_e:document.getElementById('i_e')?.textContent||'-',i_ls:document.getElementById('i_ls')?.textContent||'-',i_le:document.getElementById('i_le')?.textContent||'-',i_br_s:document.getElementById('i_br_s')?.textContent||'-',i_br_e:document.getElementById('i_br_e')?.textContent||'-',i_ps:document.getElementById('i_ps')?.textContent||'-',i_pe:document.getElementById('i_pe')?.textContent||'-',startTime:getAttendanceTime(ss,'startTime','i_s'),endTime:getAttendanceTime(ss,'endTime','i_e'),lunchStartTime:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunchEndTime:getAttendanceTime(ss,'lunchEndTime','i_le'),extraBreakStartTime:getAttendanceTime(ss,'extraBreakStartTime','i_br_s'),extraBreakEndTime:getAttendanceTime(ss,'extraBreakEndTime','i_br_e'),prayerStartTime:getAttendanceTime(ss,'prayerStartTime','i_ps'),prayerEndTime:getAttendanceTime(ss,'prayerEndTime','i_pe'),lateMin:ss.lateMin||0,autoEndDone:autoEndDone||false,lastSavedISO:tzNow().toISOString()};
  setLS(data);
}
function getTodayAutoEndDate(){
  const hh=String(AUTO_END_HOUR).padStart(2,'0');
  const mm=String(AUTO_END_MIN).padStart(2,'0');
  return new Date(`${todayISO()}T${hh}:${mm}:00+05:00`);
}
function resetEmployeeRuntimeState(){
  if(typeof stopAll==='function')stopAll();
  if(lunchActionUnlockTimer){clearTimeout(lunchActionUnlockTimer);lunchActionUnlockTimer=null;}
  empState='not_started';
  wStart=null;wAccum=0;lStart=null;lAccum=0;
  extraBreakStart=null;extraBreakAccum=0;
  prayerStart=null;prayerAccum=0;
  currentAfkStart=null;afkSeconds=0;afkCount=0;afkCurSec=0;
  isAfk=false;breakSeconds=0;autoEndDone=false;pendingAutoEndSave=false;
  lunchActionLocked=false;
  ['i_s','i_e','i_ls','i_le','i_br_s','i_br_e','i_ps','i_pe'].forEach(id=>st(id,'-'));
  ['tw','tl','tbr','tp'].forEach(id=>setTV(0,id));
  const lateTag=document.getElementById('e_ltag');
  if(lateTag)lateTag.textContent=t('lt_pre')+' 0 '+t('lt_u');
  updateAfkDisplay();updateBreakBar();updateEmpStatusTag();
}
function attendanceTimeToDate(value,date=todayISO()){
  const time=normalizeAttendanceTime(value);
  if(!time)return null;
  const parsed=new Date(`${date}T${time}+05:00`);
  return Number.isNaN(parsed.getTime())?null:parsed;
}
function attendanceDisplayTime(value){
  const time=normalizeAttendanceTime(value);
  return time?time.substring(0,5):'-';
}
function latestAttendanceDate(values,date=todayISO()){
  return (values||[]).map(value=>attendanceTimeToDate(value,date)).filter(Boolean).sort((a,b)=>b-a)[0]||null;
}
function attendanceCheckpointDate(row,fallbackValues=[]){
  const updated=row?.updated_at?new Date(row.updated_at):null;
  const now=tzNow();
  if(updated&&!Number.isNaN(updated.getTime())&&updated<=now)return updated;
  return latestAttendanceDate(fallbackValues,row?.work_date||todayISO())||now;
}
async function loadTodayAttendanceRecord(){
  if(!CU?.id)return null;
  const {data,error}=await sb.from('attendance').select('*').eq('employee_id',CU.id).eq('work_date',todayISO()).maybeSingle();
  if(error){console.warn('attendance restore:',error.message||error);return null;}
  return data||null;
}
function legacyStateBelongsToCurrentEmployee(legacy,remote){
  if(!legacy||legacy.date!==todayISO())return false;
  if(legacy.employeeId)return legacy.employeeId===CU?.id;
  if(!remote)return false;
  const localStart=getAttendanceTime(legacy,'startTime','i_s');
  const remoteStart=normalizeAttendanceTime(remote.start_time);
  return !!localStart&&localStart===remoteStart;
}
function stateFromAttendanceRecord(row){
  if(!row?.start_time)return null;
  let state='working';
  if(row.end_time)state='ended';
  else if(row.extra_break_start&&!row.extra_break_end)state='break';
  else if(row.lunch_start&&!row.lunch_end)state='lunch';

  const checkpoint=attendanceCheckpointDate(row,[row.lunch_end,row.extra_break_end,row.start_time]);
  const workStart=state==='working'?checkpoint:null;
  const lunchStart=state==='lunch'?attendanceCheckpointDate(row,[row.lunch_start]):null;
  const breakStart=state==='break'?attendanceCheckpointDate(row,[row.extra_break_start]):null;

  return {
    date:row.work_date||todayISO(),state,
    wAccum:Number(row.work_seconds)||0,lAccum:Number(row.lunch_seconds)||0,
    extraBreakAccum:Number(row.extra_break_seconds)||0,prayerAccum:0,
    afkSeconds:Number(row.afk_seconds)||0,afkCount:Number(row.afk_count)||0,breakSeconds:0,
    wStartISO:workStart?workStart.toISOString():null,
    lStartISO:lunchStart?lunchStart.toISOString():null,
    extraBreakStartISO:breakStart?breakStart.toISOString():null,
    prayerStartISO:null,afkStartISO:null,
    i_s:attendanceDisplayTime(row.start_time),i_e:attendanceDisplayTime(row.end_time),
    i_ls:attendanceDisplayTime(row.lunch_start),i_le:attendanceDisplayTime(row.lunch_end),
    i_br_s:attendanceDisplayTime(row.extra_break_start),i_br_e:attendanceDisplayTime(row.extra_break_end),
    i_ps:'-',i_pe:'-',
    startTime:normalizeAttendanceTime(row.start_time),endTime:normalizeAttendanceTime(row.end_time),
    lunchStartTime:normalizeAttendanceTime(row.lunch_start),lunchEndTime:normalizeAttendanceTime(row.lunch_end),
    extraBreakStartTime:normalizeAttendanceTime(row.extra_break_start),extraBreakEndTime:normalizeAttendanceTime(row.extra_break_end),
    prayerStartTime:null,prayerEndTime:null,
    lateMin:Number(row.late_minutes)||0,autoEndDone:!!row.auto_ended,
    lastSavedISO:checkpoint.toISOString()
  };
}
async function restoreLS(){
  resetEmployeeRuntimeState();
  let ss=getLS();
  if(ss&&(ss.employeeId!==CU?.id||ss.date!==todayISO())){removeLS();ss=null;}
  if(!ss){
    const remote=await loadTodayAttendanceRecord();
    const legacy=readLocalState(LEGACY_EMP_STATE_KEY);
    if(legacyStateBelongsToCurrentEmployee(legacy,remote)){
      ss={...legacy,employeeId:CU.id};
      setLS(ss);
    }else if(remote){
      ss=stateFromAttendanceRecord(remote);
      if(ss)setLS(ss);
    }
    if(legacy)localStorage.removeItem(LEGACY_EMP_STATE_KEY);
  }
  if(!ss){updateEmpBtns();return false;}
  empState=ss.state||'not_started';wAccum=ss.wAccum||0;lAccum=ss.lAccum||0;extraBreakAccum=ss.extraBreakAccum||0;prayerAccum=ss.prayerAccum||0;afkSeconds=ss.afkSeconds||0;afkCount=ss.afkCount||0;breakSeconds=ss.breakSeconds||0;autoEndDone=ss.autoEndDone||false;
  if(ss.wStartISO)wStart=new Date(ss.wStartISO);
  if(ss.lStartISO)lStart=new Date(ss.lStartISO);
  if(ss.extraBreakStartISO)extraBreakStart=new Date(ss.extraBreakStartISO);
  if(ss.prayerStartISO)prayerStart=new Date(ss.prayerStartISO);
  if(!autoEndDone&&['working','lunch','break','paused','prayer'].includes(empState)){
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
        if(empState==='lunch'){
          if(lStart)lAccum+=Math.max(0,Math.floor((autoEndAt-lStart)/1000));
          ss.i_le=fmtHM(autoEndAt);
          ss.lunchEndTime=fmtHMS(autoEndAt);
        }
        if(empState==='break'&&extraBreakStart)extraBreakAccum+=Math.max(0,Math.floor((autoEndAt-extraBreakStart)/1000));
        if(empState==='prayer'&&prayerStart)prayerAccum+=Math.max(0,Math.floor((autoEndAt-prayerStart)/1000));
        wStart=null;lStart=null;extraBreakStart=null;prayerStart=null;empState='ended';autoEndDone=true;
        ss.state='ended';ss.wAccum=wAccum;ss.lAccum=lAccum;ss.extraBreakAccum=extraBreakAccum;ss.prayerAccum=prayerAccum;
        ss.wStartISO=null;ss.lStartISO=null;ss.extraBreakStartISO=null;ss.prayerStartISO=null;ss.afkStartISO=null;
        ss.i_e=ss.i_e&&ss.i_e!=='-'?ss.i_e:fmtHM(autoEndAt);
        ss.endTime=ss.endTime||fmtHMS(autoEndAt);
        ss.i_br_e=ss.i_br_e&&ss.i_br_e!=='-'?ss.i_br_e:(ss.i_br_s&&ss.i_br_s!=='-'?fmtHM(autoEndAt):ss.i_br_e);
        ss.extraBreakEndTime=ss.extraBreakEndTime||(ss.i_br_s&&ss.i_br_s!=='-'?fmtHMS(autoEndAt):null);
        ss.autoEndDone=true;ss.lastSavedISO=tzNow().toISOString();
        setLS(ss);
        pendingAutoEndSave=true;
      }
    }
  }
  if(ss.afkStartISO&&empState==='working'){currentAfkStart=new Date(ss.afkStartISO);isAfk=true;const elapsed=Math.floor((tzNow()-currentAfkStart)/1000);if(elapsed>0){afkSeconds+=elapsed;breakSeconds+=elapsed;}currentAfkStart=null;isAfk=false;}
  st('i_s',ss.i_s||'-');st('i_e',ss.i_e||'-');st('i_ls',ss.i_ls||'-');st('i_le',ss.i_le||'-');st('i_br_s',ss.i_br_s||'-');st('i_br_e',ss.i_br_e||'-');st('i_ps',ss.i_ps||'-');st('i_pe',ss.i_pe||'-');
  const lt=document.getElementById('e_ltag');if(lt&&ss.lateMin!==undefined)lt.textContent=t('lt_pre')+' '+ss.lateMin+' '+t('lt_u');
  const displayWork=empState==='working'&&wStart?wAccum+Math.max(0,Math.floor((tzNow()-wStart)/1000)):wAccum;
  setTV(displayWork,'tw');setTV(lAccum,'tl');setTV(currentExtraBreakSeconds(),'tbr');setTV(prayerAccum,'tp');updateAfkDisplay();updateBreakBar();updatePrayerInfo();updateEmpBtns();updateEmpStatusTag();
  if(empState==='working')startWT();
  if(empState==='lunch')startLT();
  if(empState==='break')startBT();
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
function hasLunchStartedToday(){
  const ss=getLS()||{};
  return !!getAttendanceTime(ss,'lunchStartTime','i_ls');
}
function beginLunchAction(){
  if(lunchActionLocked)return false;
  lunchActionLocked=true;
  if(lunchActionUnlockTimer){clearTimeout(lunchActionUnlockTimer);lunchActionUnlockTimer=null;}
  const button=document.getElementById('bl');
  if(button)button.disabled=true;
  return true;
}
function finishLunchAction(){
  if(lunchActionUnlockTimer)clearTimeout(lunchActionUnlockTimer);
  lunchActionUnlockTimer=setTimeout(()=>{
    lunchActionLocked=false;
    lunchActionUnlockTimer=null;
    updateEmpBtns();
  },LUNCH_ACTION_COOLDOWN_MS);
}
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
  const ss=getLS()||{};ss.lateMin=lm;setLS(ss);
  await loadFaceControlSettings();
  updateEmpBtns();updateEmpStatusTag();startWT();saveLS();maybeStartFaceDetection();
  if(!(await savePartial(true)))return;
  toast('success',t('bs'),t('work_started_success'));
}
async function empLunch(){
  if(empState==='lunch'){await empBackLunch();return;}
  if(empState!=='working'||!beginLunchAction())return;
  try{
    if(hasLunchStartedToday()){
      toast('warn',t('lunch_title'),t('lunch_already_completed'));
      return;
    }
    lStart=tzNow();if(wStart)wAccum+=Math.floor((lStart-wStart)/1000);wStart=null;
    empState='lunch';rememberAttendanceTime('i_ls','lunchStartTime',lStart);stopWT();pauseFaceMonitoringForBreak();updateEmpBtns();updateEmpStatusTag();startLT();saveLS();
    if(!(await savePartial(true)))return;
    toast('info',t('lunch_title'),`${t('lunch_rest_msg')} 🍽️`);
  }finally{
    finishLunchAction();
  }
}
async function empBackLunch(){
  if(empState!=='lunch'||!beginLunchAction())return;
  try{
    const now=tzNow();if(lStart)lAccum+=Math.floor((now-lStart)/1000);lStart=null;
    rememberAttendanceTime('i_le','lunchEndTime',now);empState='working';wStart=now;stopLT();resumeFaceMonitoringAfterBreak();updateEmpBtns();updateEmpStatusTag();startWT();saveLS();
    if(!(await savePartial(true)))return;
    toast('success',t('lunch_title'),`${t('work_continues')} 💼`);
  }finally{
    finishLunchAction();
  }
}
async function empExtraBreak(){
  if(empState==='break'){await empBackExtraBreak();return;}
  if(empState!=='working')return;
  extraBreakStart=tzNow();
  if(wStart)wAccum+=Math.floor((extraBreakStart-wStart)/1000);
  wStart=null;
  empState='break';
  rememberAttendanceTime('i_br_s','extraBreakStartTime',extraBreakStart);
  stopWT();
  pauseFaceMonitoringForBreak();
  updateEmpBtns();updateEmpStatusTag();startBT();saveLS();
  if(!(await savePartial(true)))return;
  toast('info',t('break_btn'),t('break_started_success'));
}
async function empBackExtraBreak(){
  if(empState!=='break')return;
  const now=tzNow();
  if(extraBreakStart)extraBreakAccum+=Math.floor((now-extraBreakStart)/1000);
  extraBreakStart=null;
  rememberAttendanceTime('i_br_e','extraBreakEndTime',now);
  empState='working';
  wStart=now;
  stopBT();
  resumeFaceMonitoringAfterBreak();
  updateEmpBtns();updateEmpStatusTag();startWT();saveLS();updateBreakBar();
  if(!(await savePartial(true)))return;
  toast('success',t('break_btn'),t('break_ended_success'));
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
  if(!['working','lunch','break','paused','prayer'].includes(empState))return;
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
  if(empState==='lunch'){
    if(lStart)lAccum+=Math.floor((now-lStart)/1000);
    rememberAttendanceTime('i_le','lunchEndTime',now);
  }
  if(empState==='break'&&extraBreakStart){
    extraBreakAccum+=Math.floor((now-extraBreakStart)/1000);
    rememberAttendanceTime('i_br_e','extraBreakEndTime',now);
  }
  if(empState==='prayer'&&prayerStart)prayerAccum+=Math.floor((now-prayerStart)/1000);
  wStart=null;lStart=null;extraBreakStart=null;prayerStart=null;empState='ended';rememberAttendanceTime('i_e','endTime',now);
  stopWT();stopLT();stopBT();stopPT();document.getElementById('bc').classList.add('hidden');
  setTV(wAccum,'tw');setTV(lAccum,'tl');setTV(extraBreakAccum,'tbr');setTV(prayerAccum,'tp');updateBreakBar();updateEmpBtns();updateEmpStatusTag();stopFaceDetection();
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
  const breakTotal=extraBreakAccum||0;
  const payload={employee_id:CU.id,work_date:today,start_time:startTime,end_time:endTime,lunch_start:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunch_end:getAttendanceTime(ss,'lunchEndTime','i_le'),extra_break_start:getAttendanceTime(ss,'extraBreakStartTime','i_br_s'),extra_break_end:getAttendanceTime(ss,'extraBreakEndTime','i_br_e'),work_seconds:wAccum,lunch_seconds:lAccum,extra_break_seconds:breakTotal,extra_break_over_seconds:extraBreakOverSeconds(breakTotal),afk_seconds:getPenaltyAfkSeconds(afkSeconds),afk_count:afkCount,late_minutes:lm,status:computeStatusByTimes(startHM,endHM,lm,wAccum),auto_ended:autoEnded};
  if(!(await upsertAttendance(payload,{showError})))return false;
  loadHist();
  return true;
}
async function savePartial(showError=false){
  if(!CU||empState==='not_started')return false;
  const today=todayISO();const ss=getLS()||{};const lm=ss.lateMin||0;
  let cw=wAccum;if(empState==='working'&&wStart)cw+=Math.floor((tzNow()-wStart)/1000);
  let cl=lAccum;if(empState==='lunch'&&lStart)cl+=Math.floor((tzNow()-lStart)/1000);
  let cb=extraBreakAccum;if(empState==='break'&&extraBreakStart)cb+=Math.floor((tzNow()-extraBreakStart)/1000);
  let afkNow=afkSeconds;
  const startTime=getAttendanceTime(ss,'startTime','i_s');
  const endTime=getAttendanceTime(ss,'endTime','i_e');
  const startHM=startTime?startTime.substring(0,5):null;
  const endHM=endTime?endTime.substring(0,5):null;
  const payload={employee_id:CU.id,work_date:today,start_time:startTime,end_time:endTime,lunch_start:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunch_end:getAttendanceTime(ss,'lunchEndTime','i_le'),extra_break_start:getAttendanceTime(ss,'extraBreakStartTime','i_br_s'),extra_break_end:getAttendanceTime(ss,'extraBreakEndTime','i_br_e'),work_seconds:cw,lunch_seconds:cl,extra_break_seconds:cb,extra_break_over_seconds:extraBreakOverSeconds(cb),afk_seconds:getPenaltyAfkSeconds(afkNow),afk_count:afkCount,late_minutes:lm,status:computeStatusByTimes(startHM,endHM,lm,cw),auto_ended:false};
  return upsertAttendance(payload,{showError});
}

// ============================================================
