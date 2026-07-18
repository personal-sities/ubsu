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
let attendanceSaveQueue = Promise.resolve();
let employeeActionInFlight = null;
let employeeStateLoading = false;
let employeeDayRolloverInFlight = false;
let attendanceRpcAvailability = null;
let activeWorkDate = todayISO();

const LEGACY_EMP_STATE_KEY = 'aloqa_emp_state';
const EMP_STATE_KEY_PREFIX = `${LEGACY_EMP_STATE_KEY}:`;
const ATTENDANCE_REQUEST_TIMEOUT_MS = 15000;
const ATTENDANCE_ACTION_RPC = 'record_attendance_action';
const ATTENDANCE_SYNC_RPC = 'sync_attendance_snapshot';

function todayBreakSec(){return breakSeconds;}
function currentExtraBreakSeconds(){
  let total=extraBreakAccum||0;
  if(empState==='break'&&extraBreakStart)total+=Math.max(0,Math.floor((tzNow()-extraBreakStart)/1000));
  return total;
}
function extraBreakOverSeconds(total=currentExtraBreakSeconds()){
  return Math.max(0,Math.floor(total||0)-BREAK_LIMIT_SEC);
}

function createAttendanceRequestId(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0;
    return (c==='x'?r:(r&0x3|0x8)).toString(16);
  });
}
function attendanceActionError(code,message){
  const error=new Error(message||code);
  error.code=code;
  return error;
}
function isMissingAttendanceRpc(error){
  const text=`${error?.code||''} ${error?.message||''} ${error?.details||''}`;
  return /PGRST202|42883|could not find the function|function .* does not exist/i.test(text);
}
function isMissingPrayerColumn(error){
  const text=`${error?.code||''} ${error?.message||''} ${error?.details||''}`;
  return /PGRST204|42703/.test(text)&&/prayer_(start|end|seconds)/i.test(text);
}
function isDuplicateAttendanceRow(error){
  return error?.code==='23505'||/duplicate key|unique constraint/i.test(error?.message||'');
}
function withAttendanceTimeout(request,label=t('attendance_load_error')){
  let timer=null;
  return Promise.race([
    Promise.resolve(request),
    new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(attendanceActionError('ATTENDANCE_TIMEOUT',label)),ATTENDANCE_REQUEST_TIMEOUT_MS);
    })
  ]).finally(()=>{if(timer)clearTimeout(timer);});
}
function beginEmployeeAction(action){
  if(employeeActionInFlight)return false;
  employeeActionInFlight=action;
  updateEmpBtns();
  return true;
}
function finishEmployeeAction(action){
  if(employeeActionInFlight===action)employeeActionInFlight=null;
  updateEmpBtns();
}
function attendanceActionToast(error){
  const code=String(error?.code||'');
  const message=String(error?.message||'');
  if(/WORK_ALREADY_STARTED|23505/.test(code)||/WORK_ALREADY_STARTED/.test(message)){
    toast('warn',t('bs'),t('work_already_started'));
    return;
  }
  if(/WORK_ALREADY_ENDED/.test(code)||/WORK_ALREADY_ENDED/.test(message)){
    toast('warn',t('be'),t('work_already_ended'));
    return;
  }
  if(/LUNCH_ALREADY_STARTED/.test(code)||/LUNCH_ALREADY_STARTED/.test(message)){
    toast('warn',t('lunch_title'),t('lunch_already_active'));
    return;
  }
  if(isMissingPrayerColumn(error)){
    toast('error',t('prayer_btn'),t('attendance_schema_update_required'),6000);
    return;
  }
  toast('error',t('error_title'),message||t('attendance_save_error'),5000);
}
async function recordLegacyAttendanceAction(action,clickedAt){
  if(!CU?.id)throw attendanceActionError('NO_EMPLOYEE','Employee session topilmadi');
  const workDate=action==='work_start'?todayISO(clickedAt):(activeWorkDate||todayISO(clickedAt));
  const actionTime=fmtHMS(clickedAt);
  if(action==='work_start'){
    const lateMinutes=computeLateMinutesFromDate(clickedAt);
    const payload={
      employee_id:CU.id,
      work_date:workDate,
      start_time:actionTime,
      late_minutes:lateMinutes,
      status:computeStatusByTimes(actionTime.substring(0,5),null,lateMinutes,0)
    };
    const first=await withAttendanceTimeout(
      sb.from('attendance').insert(payload).select('*').maybeSingle(),
      t('attendance_save_error')
    );
    if(!first?.error&&first?.data)return {attendance:first.data,mode:'legacy'};
    if(!isDuplicateAttendanceRow(first?.error))throw first?.error||attendanceActionError('ATTENDANCE_SAVE_FAILED');
    const existing=await withAttendanceTimeout(
      sb.from('attendance').select('*').eq('employee_id',CU.id).eq('work_date',workDate).maybeSingle(),
      t('attendance_load_error')
    );
    if(existing?.error)throw existing.error;
    if(existing?.data?.start_time)throw attendanceActionError('WORK_ALREADY_STARTED','WORK_ALREADY_STARTED');
    const repaired=await withAttendanceTimeout(
      sb.from('attendance').update(payload).eq('employee_id',CU.id).eq('work_date',workDate).is('start_time',null).select('*').maybeSingle(),
      t('attendance_save_error')
    );
    if(repaired?.error)throw repaired.error;
    if(!repaired?.data)throw attendanceActionError('WORK_ALREADY_STARTED','WORK_ALREADY_STARTED');
    return {attendance:repaired.data,mode:'legacy'};
  }

  const patch={};
  if(action==='lunch_start'){patch.lunch_start=actionTime;patch.lunch_end=null;}
  else if(action==='lunch_end')patch.lunch_end=actionTime;
  else if(action==='break_start'){patch.extra_break_start=actionTime;patch.extra_break_end=null;}
  else if(action==='break_end')patch.extra_break_end=actionTime;
  else if(action==='prayer_start'){patch.prayer_start=actionTime;patch.prayer_end=null;}
  else if(action==='prayer_end')patch.prayer_end=actionTime;
  else if(action==='work_end'){
    patch.end_time=actionTime;
    if(empState==='lunch')patch.lunch_end=actionTime;
    if(empState==='break')patch.extra_break_end=actionTime;
    if(empState==='prayer')patch.prayer_end=actionTime;
  }else{
    throw attendanceActionError('INVALID_ATTENDANCE_ACTION',action);
  }

  let query=sb.from('attendance').update(patch)
    .eq('employee_id',CU.id)
    .eq('work_date',workDate)
    .is('end_time',null);
  if(action==='work_end')query=query.is('end_time',null);
  const result=await withAttendanceTimeout(query.select('*').maybeSingle(),t('attendance_save_error'));
  if(result?.error)throw result.error;
  if(!result?.data){
    if(action==='work_end')throw attendanceActionError('WORK_ALREADY_ENDED','WORK_ALREADY_ENDED');
    throw attendanceActionError('WORK_NOT_ACTIVE','WORK_NOT_ACTIVE');
  }
  return {attendance:result.data,mode:'legacy'};
}
async function recordAttendanceAction(action,clickedAt=tzNow()){
  const requestId=createAttendanceRequestId();
  if(attendanceRpcAvailability!==false){
    const result=await withAttendanceTimeout(
      sb.rpc(ATTENDANCE_ACTION_RPC,{
        p_action:action,
        p_request_id:requestId,
        p_clicked_at:clickedAt.toISOString()
      }),
      t('attendance_save_error')
    );
    if(!result?.error){
      attendanceRpcAvailability=true;
      return {data:result?.data,requestId,mode:'rpc'};
    }
    if(!isMissingAttendanceRpc(result.error))throw result.error;
    attendanceRpcAvailability=false;
    console.warn('Attendance RPC topilmadi, legacy Supabase yozuvi ishlatilmoqda. Migratsiyani ishga tushiring.');
  }
  const legacy=await recordLegacyAttendanceAction(action,clickedAt);
  return {...legacy,requestId};
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
function clearAttendanceTime(displayKey,exactKey){
  st(displayKey,'-');
  const ss=getLS()||{};
  ss[displayKey]='-';
  ss[exactKey]=null;
  setLS(ss);
}
async function upsertAttendance(payload,{showError=false}={}){
  const saveOperation=attendanceSaveQueue.catch(()=>{}).then(async()=>{
    if(attendanceRpcAvailability!==false){
      const rpcResult=await withAttendanceTimeout(
        sb.rpc(ATTENDANCE_SYNC_RPC,{
          p_work_date:payload.work_date,
          p_work_seconds:Math.max(0,Math.floor(payload.work_seconds||0)),
          p_lunch_seconds:Math.max(0,Math.floor(payload.lunch_seconds||0)),
          p_extra_break_seconds:Math.max(0,Math.floor(payload.extra_break_seconds||0)),
          p_prayer_seconds:Math.max(0,Math.floor(payload.prayer_seconds||0)),
          p_afk_seconds:Math.max(0,Math.floor(payload.afk_seconds||0)),
          p_afk_count:Math.max(0,Math.floor(payload.afk_count||0)),
          p_status:payload.status||'keldi',
          p_auto_ended:payload.auto_ended===true
        }),
        t('attendance_save_error')
      );
      if(!rpcResult?.error){
        attendanceRpcAvailability=true;
        return true;
      }
      if(!isMissingAttendanceRpc(rpcResult.error)){
        console.warn('attendance sync:',rpcResult.error.message||rpcResult.error);
        if(showError)toast('error',t('error_title'),rpcResult.error.message||t('attendance_save_error'));
        return false;
      }
      attendanceRpcAvailability=false;
    }

    const metrics={
      work_seconds:Math.max(0,Math.floor(payload.work_seconds||0)),
      lunch_seconds:Math.max(0,Math.floor(payload.lunch_seconds||0)),
      extra_break_seconds:Math.max(0,Math.floor(payload.extra_break_seconds||0)),
      extra_break_over_seconds:Math.max(0,Math.floor(payload.extra_break_over_seconds||0)),
      prayer_seconds:Math.max(0,Math.floor(payload.prayer_seconds||0)),
      afk_seconds:Math.max(0,Math.floor(payload.afk_seconds||0)),
      afk_count:Math.max(0,Math.floor(payload.afk_count||0)),
      status:payload.status||'keldi'
    };
    if(payload.auto_ended===true)metrics.auto_ended=true;
    const runUpdate=async values=>{
      let query=sb.from('attendance').update(values)
        .eq('employee_id',payload.employee_id)
        .eq('work_date',payload.work_date);
      if(empState!=='ended')query=query.is('end_time',null);
      return withAttendanceTimeout(query.select('id').maybeSingle(),t('attendance_save_error'));
    };
    let result=await runUpdate(metrics);
    if(result?.error&&isMissingPrayerColumn(result.error)){
      const compatibleMetrics={...metrics};
      delete compatibleMetrics.prayer_seconds;
      result=await runUpdate(compatibleMetrics);
    }
    if(result?.error||!result?.data){
      const error=result?.error||attendanceActionError('ATTENDANCE_ROW_NOT_ACTIVE',t('attendance_save_error'));
      console.warn('attendance save:',error.message||error);
      if(showError)toast('error',t('error_title'),error.message||t('attendance_save_error'));
      return false;
    }
    return true;
  });
  attendanceSaveQueue=saveOperation.then(()=>undefined,()=>undefined);
  return saveOperation;
}
function saveLS(){
  const ss=getLS()||{};
  const data={date:activeWorkDate||todayISO(),state:empState,wAccum,lAccum,extraBreakAccum,prayerAccum,afkSeconds,afkCount,breakSeconds,wStartISO:wStart?wStart.toISOString():null,lStartISO:lStart?lStart.toISOString():null,extraBreakStartISO:extraBreakStart?extraBreakStart.toISOString():null,prayerStartISO:prayerStart?prayerStart.toISOString():null,afkStartISO:currentAfkStart?currentAfkStart.toISOString():null,i_s:document.getElementById('i_s')?.textContent||'-',i_e:document.getElementById('i_e')?.textContent||'-',i_ls:document.getElementById('i_ls')?.textContent||'-',i_le:document.getElementById('i_le')?.textContent||'-',i_br_s:document.getElementById('i_br_s')?.textContent||'-',i_br_e:document.getElementById('i_br_e')?.textContent||'-',i_ps:document.getElementById('i_ps')?.textContent||'-',i_pe:document.getElementById('i_pe')?.textContent||'-',startTime:getAttendanceTime(ss,'startTime','i_s'),endTime:getAttendanceTime(ss,'endTime','i_e'),lunchStartTime:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunchEndTime:getAttendanceTime(ss,'lunchEndTime','i_le'),extraBreakStartTime:getAttendanceTime(ss,'extraBreakStartTime','i_br_s'),extraBreakEndTime:getAttendanceTime(ss,'extraBreakEndTime','i_br_e'),prayerStartTime:getAttendanceTime(ss,'prayerStartTime','i_ps'),prayerEndTime:getAttendanceTime(ss,'prayerEndTime','i_pe'),lateMin:ss.lateMin||0,autoEndDone:autoEndDone||false,lastSavedISO:tzNow().toISOString()};
  setLS(data);
}
function getWorkDateAutoEndDate(workDate=activeWorkDate||todayISO()){
  const hh=String(AUTO_END_HOUR).padStart(2,'0');
  const mm=String(AUTO_END_MIN).padStart(2,'0');
  return new Date(`${workDate}T${hh}:${mm}:00+05:00`);
}
function getTodayAutoEndDate(){return getWorkDateAutoEndDate(todayISO());}
function resetEmployeeRuntimeState(workDate=todayISO()){
  if(typeof stopAll==='function')stopAll();
  empState='not_started';
  wStart=null;wAccum=0;lStart=null;lAccum=0;
  extraBreakStart=null;extraBreakAccum=0;
  prayerStart=null;prayerAccum=0;
  currentAfkStart=null;afkSeconds=0;afkCount=0;afkCurSec=0;
  isAfk=false;breakSeconds=0;autoEndDone=false;
  activeWorkDate=workDate;
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
async function loadTodayAttendanceRecord(workDate=todayISO()){
  if(!CU?.id)return null;
  const {data,error}=await withAttendanceTimeout(
    sb.from('attendance').select('*').eq('employee_id',CU.id).eq('work_date',workDate).maybeSingle(),
    t('attendance_load_error')
  );
  if(error)throw error;
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
  const validStates=['working','lunch','break','prayer','paused','ended'];
  let state=validStates.includes(row.current_state)?row.current_state:'working';
  if(row.end_time)state='ended';
  else if(!validStates.includes(row.current_state)){
    if(row.prayer_start&&!row.prayer_end)state='prayer';
    else if(row.extra_break_start&&!row.extra_break_end)state='break';
    else if(row.lunch_start&&!row.lunch_end)state='lunch';
  }

  const checkpoint=attendanceCheckpointDate(row,[row.prayer_end,row.lunch_end,row.extra_break_end,row.start_time]);
  const workStart=state==='working'?checkpoint:null;
  const lunchStart=state==='lunch'?attendanceCheckpointDate(row,[row.lunch_start]):null;
  const breakStart=state==='break'?attendanceCheckpointDate(row,[row.extra_break_start]):null;
  const activePrayerStart=state==='prayer'?attendanceCheckpointDate(row,[row.prayer_start]):null;

  return {
    date:row.work_date||todayISO(),state,
    wAccum:Number(row.work_seconds)||0,lAccum:Number(row.lunch_seconds)||0,
    extraBreakAccum:Number(row.extra_break_seconds)||0,prayerAccum:Number(row.prayer_seconds)||0,
    afkSeconds:Number(row.afk_seconds)||0,afkCount:Number(row.afk_count)||0,breakSeconds:0,
    wStartISO:workStart?workStart.toISOString():null,
    lStartISO:lunchStart?lunchStart.toISOString():null,
    extraBreakStartISO:breakStart?breakStart.toISOString():null,
    prayerStartISO:activePrayerStart?activePrayerStart.toISOString():null,afkStartISO:null,
    i_s:attendanceDisplayTime(row.start_time),i_e:attendanceDisplayTime(row.end_time),
    i_ls:attendanceDisplayTime(row.lunch_start),i_le:attendanceDisplayTime(row.lunch_end),
    i_br_s:attendanceDisplayTime(row.extra_break_start),i_br_e:attendanceDisplayTime(row.extra_break_end),
    i_ps:attendanceDisplayTime(row.prayer_start),i_pe:attendanceDisplayTime(row.prayer_end),
    startTime:normalizeAttendanceTime(row.start_time),endTime:normalizeAttendanceTime(row.end_time),
    lunchStartTime:normalizeAttendanceTime(row.lunch_start),lunchEndTime:normalizeAttendanceTime(row.lunch_end),
    extraBreakStartTime:normalizeAttendanceTime(row.extra_break_start),extraBreakEndTime:normalizeAttendanceTime(row.extra_break_end),
    prayerStartTime:normalizeAttendanceTime(row.prayer_start),prayerEndTime:normalizeAttendanceTime(row.prayer_end),
    lateMin:Number(row.late_minutes)||0,autoEndDone:!!row.auto_ended,
    lastSavedISO:checkpoint.toISOString()
  };
}
async function restoreLS(){
  const workDate=todayISO();
  employeeStateLoading=true;
  resetEmployeeRuntimeState(workDate);
  updateEmpBtns();
  let local=getLS();
  if(local&&local.employeeId!==CU?.id){removeLS();local=null;}
  const localMatchesToday=!!local&&local.date===workDate;
  let remote=null;
  let remoteLoaded=false;
  try{
    remote=await loadTodayAttendanceRecord(workDate);
    remoteLoaded=true;
  }catch(error){
    console.warn('attendance restore:',error.message||error);
    if(local)toast('warn',t('error_title'),t('attendance_restore_offline'),5000);
  }
  if(remoteLoaded&&!localMatchesToday){removeLS();local=null;}
  const legacy=readLocalState(LEGACY_EMP_STATE_KEY);
  if(legacy)localStorage.removeItem(LEGACY_EMP_STATE_KEY);
  let ss=remote?stateFromAttendanceRecord(remote):(!remoteLoaded?local:null);
  if(!ss&&legacyStateBelongsToCurrentEmployee(legacy,remote))ss={...legacy,employeeId:CU.id};
  if(!ss){
    removeLS();
    employeeStateLoading=false;
    updateEmpBtns();
    return false;
  }
  activeWorkDate=ss.date||workDate;
  setLS({...ss,employeeId:CU.id});
  empState=ss.state||'not_started';wAccum=ss.wAccum||0;lAccum=ss.lAccum||0;extraBreakAccum=ss.extraBreakAccum||0;prayerAccum=ss.prayerAccum||0;afkSeconds=ss.afkSeconds||0;afkCount=ss.afkCount||0;breakSeconds=ss.breakSeconds||0;autoEndDone=ss.autoEndDone||false;
  if(ss.wStartISO)wStart=new Date(ss.wStartISO);
  if(ss.lStartISO)lStart=new Date(ss.lStartISO);
  if(ss.extraBreakStartISO)extraBreakStart=new Date(ss.extraBreakStartISO);
  if(ss.prayerStartISO)prayerStart=new Date(ss.prayerStartISO);
  if(ss.afkStartISO&&empState==='working'){currentAfkStart=new Date(ss.afkStartISO);isAfk=true;const elapsed=Math.floor((tzNow()-currentAfkStart)/1000);if(elapsed>0){afkSeconds+=elapsed;breakSeconds+=elapsed;}currentAfkStart=null;isAfk=false;}
  st('i_s',ss.i_s||'-');st('i_e',ss.i_e||'-');st('i_ls',ss.i_ls||'-');st('i_le',ss.i_le||'-');st('i_br_s',ss.i_br_s||'-');st('i_br_e',ss.i_br_e||'-');st('i_ps',ss.i_ps||'-');st('i_pe',ss.i_pe||'-');
  const lt=document.getElementById('e_ltag');if(lt&&ss.lateMin!==undefined)lt.textContent=t('lt_pre')+' '+ss.lateMin+' '+t('lt_u');
  const displayWork=empState==='working'&&wStart?wAccum+Math.max(0,Math.floor((tzNow()-wStart)/1000)):wAccum;
  employeeStateLoading=false;
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
async function reconcileAttendanceAfterFailure(error){
  attendanceActionToast(error);
  try{await restoreLS();}
  catch(restoreError){console.warn('attendance reconcile:',restoreError.message||restoreError);}
}
async function ensureCurrentEmployeeActionDate(){
  if(activeWorkDate===todayISO())return true;
  await ensureEmployeeDayRollover();
  return activeWorkDate===todayISO();
}
async function empStart(){
  if(!(await ensureCurrentEmployeeActionDate()))return;
  if(empState!=='not_started')return;
  const clickedAt=tzNow();
  if(!beginEmployeeAction('work_start'))return;
  try{
    const access=await checkRegionAccess('employee');
    if(!access.ok){
      showIPBlock(access.value, access.title, access.message);
      await sb.auth.signOut();
      return;
    }
    await recordAttendanceAction('work_start',clickedAt);
    activeWorkDate=todayISO(clickedAt);
    wStart=clickedAt;empState='working';
    rememberAttendanceTime('i_s','startTime',wStart);
    const lm=computeLateMinutesFromDate(wStart);
    const el=document.getElementById('e_ltag');if(el)el.textContent=t('lt_pre')+' '+lm+' '+t('lt_u');
    const ss=getLS()||{};ss.lateMin=lm;setLS(ss);
    try{await loadFaceControlSettings();}catch(error){console.warn('face settings:',error.message||error);}
    updateEmpBtns();updateEmpStatusTag();startWT();saveLS();maybeStartFaceDetection();
    savePartial().catch(error=>console.warn('attendance start snapshot:',error.message||error));
    toast('success',t('bs'),t('work_started_success'));
  }catch(error){
    await reconcileAttendanceAfterFailure(error);
  }finally{
    finishEmployeeAction('work_start');
  }
}
// Supabase-first action handlers: local UI changes only after the remote event is saved.
async function empLunch(){
  if(!(await ensureCurrentEmployeeActionDate()))return;
  if(empState==='lunch'){await empBackLunch();return;}
  if(empState!=='working')return;
  const clickedAt=tzNow();
  if(!beginEmployeeAction('lunch_start'))return;
  try{
    await recordAttendanceAction('lunch_start',clickedAt);
    lStart=clickedAt;
    if(wStart)wAccum+=Math.max(0,Math.floor((lStart-wStart)/1000));
    wStart=null;empState='lunch';
    clearAttendanceTime('i_le','lunchEndTime');
    rememberAttendanceTime('i_ls','lunchStartTime',lStart);
    stopWT();pauseFaceMonitoringForBreak();updateEmpBtns();updateEmpStatusTag();startLT();saveLS();
    savePartial().catch(error=>console.warn('attendance lunch snapshot:',error.message||error));
    toast('info',t('lunch_title'),t('lunch_rest_msg'));
  }catch(error){
    await reconcileAttendanceAfterFailure(error);
  }finally{
    finishEmployeeAction('lunch_start');
  }
}
async function empBackLunch(){
  if(!(await ensureCurrentEmployeeActionDate()))return;
  if(empState!=='lunch')return;
  const clickedAt=tzNow();
  if(!beginEmployeeAction('lunch_end'))return;
  try{
    await recordAttendanceAction('lunch_end',clickedAt);
    if(lStart)lAccum+=Math.max(0,Math.floor((clickedAt-lStart)/1000));
    lStart=null;rememberAttendanceTime('i_le','lunchEndTime',clickedAt);
    empState='working';wStart=clickedAt;
    stopLT();resumeFaceMonitoringAfterBreak();updateEmpBtns();updateEmpStatusTag();startWT();saveLS();
    savePartial().catch(error=>console.warn('attendance lunch-end snapshot:',error.message||error));
    toast('success',t('lunch_title'),t('work_continues'));
  }catch(error){
    await reconcileAttendanceAfterFailure(error);
  }finally{
    finishEmployeeAction('lunch_end');
  }
}
async function empExtraBreak(){
  if(!(await ensureCurrentEmployeeActionDate()))return;
  if(empState==='break'){await empBackExtraBreak();return;}
  if(empState!=='working')return;
  const clickedAt=tzNow();
  if(!beginEmployeeAction('break_start'))return;
  try{
    await recordAttendanceAction('break_start',clickedAt);
    extraBreakStart=clickedAt;
    if(wStart)wAccum+=Math.max(0,Math.floor((extraBreakStart-wStart)/1000));
    wStart=null;empState='break';
    clearAttendanceTime('i_br_e','extraBreakEndTime');
    rememberAttendanceTime('i_br_s','extraBreakStartTime',extraBreakStart);
    stopWT();pauseFaceMonitoringForBreak();updateEmpBtns();updateEmpStatusTag();startBT();saveLS();
    savePartial().catch(error=>console.warn('attendance break snapshot:',error.message||error));
    toast('info',t('break_btn'),t('break_started_success'));
  }catch(error){
    await reconcileAttendanceAfterFailure(error);
  }finally{
    finishEmployeeAction('break_start');
  }
}
async function empBackExtraBreak(){
  if(!(await ensureCurrentEmployeeActionDate()))return;
  if(empState!=='break')return;
  const clickedAt=tzNow();
  if(!beginEmployeeAction('break_end'))return;
  try{
    await recordAttendanceAction('break_end',clickedAt);
    if(extraBreakStart)extraBreakAccum+=Math.max(0,Math.floor((clickedAt-extraBreakStart)/1000));
    extraBreakStart=null;rememberAttendanceTime('i_br_e','extraBreakEndTime',clickedAt);
    empState='working';wStart=clickedAt;
    stopBT();resumeFaceMonitoringAfterBreak();updateEmpBtns();updateEmpStatusTag();startWT();saveLS();updateBreakBar();
    savePartial().catch(error=>console.warn('attendance break-end snapshot:',error.message||error));
    toast('success',t('break_btn'),t('break_ended_success'));
  }catch(error){
    await reconcileAttendanceAfterFailure(error);
  }finally{
    finishEmployeeAction('break_end');
  }
}
async function empPrayer(){
  if(!(await ensureCurrentEmployeeActionDate()))return;
  if(empState==='prayer'){await empBackPrayer();return;}
  if(empState!=='working')return;
  const clickedAt=tzNow();
  if(!beginEmployeeAction('prayer_start'))return;
  try{
    await recordAttendanceAction('prayer_start',clickedAt);
    prayerStart=clickedAt;
    if(wStart)wAccum+=Math.max(0,Math.floor((prayerStart-wStart)/1000));
    wStart=null;empState='prayer';
    clearAttendanceTime('i_pe','prayerEndTime');
    rememberAttendanceTime('i_ps','prayerStartTime',prayerStart);
    stopWT();pauseFaceMonitoringForBreak();updateEmpBtns();updateEmpStatusTag();startPT();saveLS();
    savePartial().catch(error=>console.warn('attendance prayer snapshot:',error.message||error));
    toast('info',t('prayer_btn'),t('prayer_started_success'));
  }catch(error){
    await reconcileAttendanceAfterFailure(error);
  }finally{
    finishEmployeeAction('prayer_start');
  }
}
async function empBackPrayer(){
  if(!(await ensureCurrentEmployeeActionDate()))return;
  if(empState!=='prayer')return;
  const clickedAt=tzNow();
  if(!beginEmployeeAction('prayer_end'))return;
  try{
    await recordAttendanceAction('prayer_end',clickedAt);
    if(prayerStart)prayerAccum+=Math.max(0,Math.floor((clickedAt-prayerStart)/1000));
    prayerStart=null;rememberAttendanceTime('i_pe','prayerEndTime',clickedAt);
    empState='working';wStart=clickedAt;
    stopPT();resumeFaceMonitoringAfterBreak();updateEmpBtns();updateEmpStatusTag();startWT();saveLS();
    savePartial().catch(error=>console.warn('attendance prayer-end snapshot:',error.message||error));
    toast('success',t('prayer_btn'),t('work_continues'));
  }catch(error){
    await reconcileAttendanceAfterFailure(error);
  }finally{
    finishEmployeeAction('prayer_end');
  }
}
async function empContinue(){
  if(!(await ensureCurrentEmployeeActionDate()))return;
  if(empState!=='paused'||!beginEmployeeAction('work_resume'))return;
  try{
    empState='working';wStart=tzNow();
    document.getElementById('bc').classList.add('hidden');
    updateEmpBtns();updateEmpStatusTag();startWT();saveLS();maybeStartFaceDetection();
    savePartial().catch(error=>console.warn('attendance resume snapshot:',error.message||error));
  }finally{
    finishEmployeeAction('work_resume');
  }
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
async function ensureEmployeeDayRollover(){
  const currentDate=todayISO();
  if(!CU||CU.role!=='employee'||activeWorkDate===currentDate||employeeDayRolloverInFlight)return false;
  employeeDayRolloverInFlight=true;
  try{
    if(['working','lunch','break','paused','prayer'].includes(empState)){
      const finished=await empEnd(true,getWorkDateAutoEndDate(activeWorkDate));
      if(!finished&&!['ended','not_started'].includes(empState))return false;
    }
    if(['ended','not_started'].includes(empState)){
      removeLS();
      resetEmployeeRuntimeState(currentDate);
      const autoModal=document.getElementById('m_auto_end');if(autoModal)autoModal.classList.add('hidden');
      const autoBanner=document.getElementById('autoEndBanner');if(autoBanner)autoBanner.style.display='none';
      updateEmpBtns();updateEmpStatusTag();setEmpMonth();loadHist();
      return true;
    }
    return false;
  }finally{
    employeeDayRolloverInFlight=false;
  }
}
async function empEnd(auto=false,forcedAt=null){
  if(!forcedAt&&!(await ensureCurrentEmployeeActionDate()))return false;
  if(!['working','lunch','break','paused','prayer'].includes(empState))return false;
  const clickedAt=forcedAt instanceof Date?forcedAt:tzNow();
  if(!beginEmployeeAction('work_end'))return false;
  try{
    if(!auto){
      canFinishWorkByAmoCrmTasks({auto:false}).catch(error=>console.warn('finish task warning:',error.message||error));
    }
    await recordAttendanceAction('work_end',clickedAt);
    if(empState==='working'&&wStart)wAccum+=Math.max(0,Math.floor((clickedAt-wStart)/1000));
    if(empState==='lunch'){
      if(lStart)lAccum+=Math.max(0,Math.floor((clickedAt-lStart)/1000));
      rememberAttendanceTime('i_le','lunchEndTime',clickedAt);
    }
    if(empState==='break'&&extraBreakStart){
      extraBreakAccum+=Math.max(0,Math.floor((clickedAt-extraBreakStart)/1000));
      rememberAttendanceTime('i_br_e','extraBreakEndTime',clickedAt);
    }
    if(empState==='prayer'){
      if(prayerStart)prayerAccum+=Math.max(0,Math.floor((clickedAt-prayerStart)/1000));
      rememberAttendanceTime('i_pe','prayerEndTime',clickedAt);
    }
    wStart=null;lStart=null;extraBreakStart=null;prayerStart=null;empState='ended';
    rememberAttendanceTime('i_e','endTime',clickedAt);
    stopWT();stopLT();stopBT();stopPT();document.getElementById('bc').classList.add('hidden');
    setTV(wAccum,'tw');setTV(lAccum,'tl');setTV(extraBreakAccum,'tbr');setTV(prayerAccum,'tp');
    updateBreakBar();updateEmpBtns();updateEmpStatusTag();stopFaceDetection();
    if(auto)autoEndDone=true;
    saveLS();
    saveAtt(auto).catch(error=>console.warn('attendance end snapshot:',error.message||error));
    if(auto){
      document.getElementById('m_auto_end').classList.remove('hidden');
      document.getElementById('autoEndBanner').style.display='block';
      setTimeout(()=>document.getElementById('autoEndBanner').style.display='none',5000);
    }else{
      toast('success',t('be'),t('day_finished_success'));
    }
    return true;
  }catch(error){
    await reconcileAttendanceAfterFailure(error);
    return false;
  }finally{
    finishEmployeeAction('work_end');
  }
}
async function saveAtt(autoEnded=false,showError=false){
  if(!CU)return false;
  const workDate=activeWorkDate||todayISO();const ss=getLS()||{};const lm=ss.lateMin||0;
  const startTime=getAttendanceTime(ss,'startTime','i_s');
  const endTime=getAttendanceTime(ss,'endTime','i_e');
  const startHM=startTime?startTime.substring(0,5):null;
  const endHM=endTime?endTime.substring(0,5):null;
  const breakTotal=extraBreakAccum||0;
  const payload={employee_id:CU.id,work_date:workDate,start_time:startTime,end_time:endTime,lunch_start:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunch_end:getAttendanceTime(ss,'lunchEndTime','i_le'),extra_break_start:getAttendanceTime(ss,'extraBreakStartTime','i_br_s'),extra_break_end:getAttendanceTime(ss,'extraBreakEndTime','i_br_e'),prayer_start:getAttendanceTime(ss,'prayerStartTime','i_ps'),prayer_end:getAttendanceTime(ss,'prayerEndTime','i_pe'),work_seconds:wAccum,lunch_seconds:lAccum,extra_break_seconds:breakTotal,extra_break_over_seconds:extraBreakOverSeconds(breakTotal),prayer_seconds:prayerAccum||0,afk_seconds:getPenaltyAfkSeconds(afkSeconds),afk_count:afkCount,late_minutes:lm,status:computeStatusByTimes(startHM,endHM,lm,wAccum),auto_ended:autoEnded};
  if(!(await upsertAttendance(payload,{showError})))return false;
  loadHist();
  return true;
}
async function savePartial(showError=false){
  if(!CU||empState==='not_started')return false;
  const workDate=activeWorkDate||todayISO();const ss=getLS()||{};const lm=ss.lateMin||0;
  let cw=wAccum;if(empState==='working'&&wStart)cw+=Math.floor((tzNow()-wStart)/1000);
  let cl=lAccum;if(empState==='lunch'&&lStart)cl+=Math.floor((tzNow()-lStart)/1000);
  let cb=extraBreakAccum;if(empState==='break'&&extraBreakStart)cb+=Math.floor((tzNow()-extraBreakStart)/1000);
  let cp=prayerAccum;if(empState==='prayer'&&prayerStart)cp+=Math.floor((tzNow()-prayerStart)/1000);
  let afkNow=afkSeconds;
  const startTime=getAttendanceTime(ss,'startTime','i_s');
  const endTime=getAttendanceTime(ss,'endTime','i_e');
  const startHM=startTime?startTime.substring(0,5):null;
  const endHM=endTime?endTime.substring(0,5):null;
  const payload={employee_id:CU.id,work_date:workDate,start_time:startTime,end_time:endTime,lunch_start:getAttendanceTime(ss,'lunchStartTime','i_ls'),lunch_end:getAttendanceTime(ss,'lunchEndTime','i_le'),extra_break_start:getAttendanceTime(ss,'extraBreakStartTime','i_br_s'),extra_break_end:getAttendanceTime(ss,'extraBreakEndTime','i_br_e'),prayer_start:getAttendanceTime(ss,'prayerStartTime','i_ps'),prayer_end:getAttendanceTime(ss,'prayerEndTime','i_pe'),work_seconds:cw,lunch_seconds:cl,extra_break_seconds:cb,extra_break_over_seconds:extraBreakOverSeconds(cb),prayer_seconds:cp,afk_seconds:getPenaltyAfkSeconds(afkNow),afk_count:afkCount,late_minutes:lm,status:computeStatusByTimes(startHM,endHM,lm,cw),auto_ended:false};
  return upsertAttendance(payload,{showError});
}

// ============================================================
