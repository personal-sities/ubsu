//  TIME UTILS
// ============================================================
const tzPartFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TASHKENT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});
function getTzParts(date=new Date()){
  const map = {};
  tzPartFormatter.formatToParts(date).forEach(part => {
    if(part.type !== 'literal') map[part.type] = part.value;
  });
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}
function getTzTotalMinutes(date=new Date()){
  const parts = getTzParts(date);
  return parts.hour * 60 + parts.minute;
}
function tzNow(){return new Date();}
function fmtD(d){const p=getTzParts(d);return String(p.day).padStart(2,'0')+'.'+String(p.month).padStart(2,'0')+'.'+p.year;}
function todayISO(date=new Date()){const p=getTzParts(date);return p.year+'-'+String(p.month).padStart(2,'0')+'-'+String(p.day).padStart(2,'0');}
function curM(){const p=getTzParts();return p.year+'-'+String(p.month).padStart(2,'0');}
function fmtHM(d){const p=getTzParts(d);return String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0');}
function fmtHMS(d){const p=getTzParts(d);return String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0')+':'+String(p.second).padStart(2,'0');}
function fmtSec(s){s=Math.max(0,Math.floor(s));return String(Math.floor(s/3600)).padStart(2,'0')+':'+String(Math.floor((s%3600)/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
function secToHMS(sec){return fmtSec(sec);}
function fmtSecMM(s){s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
function hmToMinutes(v){if(!v||typeof v!=='string'||!v.includes(':'))return null;const[a,b]=v.split(':').map(Number);return a*60+b;}
function computeLateMinutesFromDate(d){if(!d)return 0;return Math.max(0, getTzTotalMinutes(d) - LATE_AFTER_MINUTES);}
function isHalfDayByTimes(startHM,endHM){
  const s=hmToMinutes(startHM), e=hmToMinutes(endHM);
  return (s!==null && s>=HALF_DAY_START_MINUTES) || (e!==null && e<HALF_DAY_END_MINUTES);
}
function getPenaltyAfkSeconds(totalAfkSec=0){
  return Math.max(0, Math.floor(totalAfkSec||0) - BREAK_LIMIT_SEC);
}
function formatPenaltyAfk(sec=0){
  const mins=Math.floor((sec||0)/60);
  return mins>0 ? `${mins} ${t('daq')}` : '—';
}
function computeStatusByTimes(startHM,endHM,lateMin,workSec){
  if(isHalfDayByTimes(startHM,endHM)) return 'yarim_kun';
  if((lateMin||0)>0) return 'kechikkan';
  return 'keldi';
}
function computeEfficiencyScore({workSec=0, workDays=0, cameDays=0, halfDays=0, lateCount=0, afkSec=0}={}){
  if(workDays<=0)return 0;
  const expectedSec=workDays*TARGET_WORK_SEC_PER_DAY;
  const workRate=Math.min(100,Math.round((workSec/expectedSec)*100));
  const effectiveAttendance=Math.max(0,cameDays-(halfDays*0.5));
  const attendanceRate=Math.min(100,Math.round((effectiveAttendance/workDays)*100));
  const afkPenalty=Math.min(25,Math.floor(Math.max(0,afkSec-BREAK_LIMIT_SEC)/60));
  const disciplineRate=Math.max(0,100-(lateCount*4)-afkPenalty);
  return Math.max(0,Math.min(100,Math.round((workRate*0.55)+(attendanceRate*0.30)+(disciplineRate*0.15))));
}
function isWorkDay(ds){const d=new Date(ds+'T12:00:00');if(d.getDay()===0)return false;return!JSON.parse(localStorage.getItem('aloqa_hols')||'[]').includes(ds);}
let employeeLeavesTableAvailable = true;
let latestTodayLeaveRows = [];
const LOCAL_EMPLOYEE_LEAVES_KEY = 'aloqa_employee_leaves';
function normalizeIsoDate(ds=''){return /^\d{4}-\d{2}-\d{2}$/.test(ds||'') ? ds : '';}
function dateRangesOverlap(startA,endA,startB,endB){return startA<=endB && endA>=startB;}
function getLocalEmployeeLeaves(){
  try{
    const rows=JSON.parse(localStorage.getItem(LOCAL_EMPLOYEE_LEAVES_KEY)||'[]');
    return Array.isArray(rows)?rows.filter(row=>row&&row.employee_id&&normalizeIsoDate(row.leave_start_date)&&normalizeIsoDate(row.return_date)):[];
  }catch(_){
    return [];
  }
}
function setLocalEmployeeLeaves(rows){
  localStorage.setItem(LOCAL_EMPLOYEE_LEAVES_KEY, JSON.stringify(rows||[]));
}
function getLeaveRowsForRange(rows,startDate,endDate){
  return (rows||[]).filter(row=>{
    const leaveStart=normalizeIsoDate(row.leave_start_date);
    const leaveEnd=normalizeIsoDate(row.return_date);
    return leaveStart && leaveEnd && dateRangesOverlap(leaveStart,leaveEnd,startDate,endDate);
  });
}
async function fetchEmployeeLeavesInRange(startDate,endDate){
  if(!employeeLeavesTableAvailable)return getLeaveRowsForRange(getLocalEmployeeLeaves(),startDate,endDate);
  try{
    const {data,error} = await sb
      .from('employee_leaves')
      .select('id,employee_id,leave_start_date,return_date,created_at')
      .lte('leave_start_date', endDate)
      .gte('return_date', startDate)
      .order('leave_start_date', {ascending:false});
    if(error){
      if(/employee_leaves|relation/i.test(error.message||'')){
        employeeLeavesTableAvailable=false;
        return getLeaveRowsForRange(getLocalEmployeeLeaves(),startDate,endDate);
      }
      console.warn('fetchEmployeeLeavesInRange:', error.message || error);
      return [];
    }
    return (data||[]).filter(row=>normalizeIsoDate(row.leave_start_date)&&normalizeIsoDate(row.return_date));
  }catch(e){
    console.warn('fetchEmployeeLeavesInRange:', e.message || e);
    return [];
  }
}
function buildEmployeeLeaveDateMap(leaves,startDate,endDate){
  const map=new Map();
  (leaves||[]).forEach(leave=>{
    const leaveStart=normalizeIsoDate(leave.leave_start_date);
    const leaveEnd=normalizeIsoDate(leave.return_date);
    if(!leaveStart||!leaveEnd||!dateRangesOverlap(leaveStart,leaveEnd,startDate,endDate))return;
    const effectiveStart = leaveStart>startDate ? leaveStart : startDate;
    const effectiveEnd = leaveEnd<endDate ? leaveEnd : endDate;
    if(!map.has(leave.employee_id))map.set(leave.employee_id,new Set());
    const set=map.get(leave.employee_id);
    for(let ds=effectiveStart; ds<=effectiveEnd; ds=addDaysISO(ds,1))set.add(ds);
  });
  return map;
}
function isEmployeeOnLeaveDate(employeeId, ds, leaveDateMap){
  return !!(employeeId && ds && leaveDateMap?.get(employeeId)?.has(ds));
}
async function loadEmployeeLeaveAdminList(){
  const tbody=document.getElementById('leave_admin_body');
  if(!tbody)return;
  tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:18px">${t('loading')}</td></tr>`;
  try{
    const [{data:emps,error:empErr}, leaveRes] = await Promise.all([
      sb.from('employees').select('id,name').eq('active',true).order('name'),
      employeeLeavesTableAvailable
        ? sb.from('employee_leaves').select('id,employee_id,leave_start_date,return_date,created_at').order('leave_start_date',{ascending:false})
        : Promise.resolve({data:getLocalEmployeeLeaves(), error:null})
    ]);
    const empMap=new Map(((emps||[])).map(emp=>[emp.id, emp.name||'-']));
    let rows=[];
    if(!empErr){
      if(leaveRes?.error){
        if(/employee_leaves|relation/i.test(leaveRes.error.message||'')){
          employeeLeavesTableAvailable=false;
          toast('warn', t('work_leave'), t('leave_table_missing'));
          rows=getLocalEmployeeLeaves();
        }else{
          throw leaveRes.error;
        }
      }else{
        rows=(leaveRes?.data||[]);
      }
    }else{
      throw empErr;
    }
    rows=(rows||[])
      .filter(row=>row&&row.employee_id&&normalizeIsoDate(row.leave_start_date)&&normalizeIsoDate(row.return_date))
      .sort((a,b)=>(b.leave_start_date||'').localeCompare(a.leave_start_date||''));
    tbody.innerHTML='';
    if(!rows.length){
      tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:18px">${t('leave_admin_empty')}</td></tr>`;
      return;
    }
    const today=todayISO();
    rows.forEach((row,i)=>{
      const tr=document.createElement('tr');
      const status=today<=row.return_date?t('on_work_leave'):t('returned');
      const source = row.id && String(row.id).startsWith('local_') ? 'local' : 'remote';
      tr.innerHTML=`<td>${i+1}</td><td>${empMap.get(row.employee_id)||'-'}</td><td style="font-family:var(--mono)">${row.leave_start_date}</td><td style="font-family:var(--mono)">${row.return_date}</td><td><span class="badge bauto">${status}</span></td><td><button class="brd" onclick="removeEmployeeLeave('${row.id}','${source}')">${t('delete')}</button></td>`;
      tbody.appendChild(tr);
    });
  }catch(e){
    tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:18px">${e.message||t('leave_save_error')}</td></tr>`;
  }
}
function saveLocalEmployeeLeave(payload){
  const rows=getLocalEmployeeLeaves();
  rows.push({
    id:`local_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    employee_id:payload.employee_id,
    leave_start_date:payload.leave_start_date,
    return_date:payload.return_date,
    created_at:new Date().toISOString()
  });
  setLocalEmployeeLeaves(rows);
}
async function addEmployeeLeave(){
  const employeeId=document.getElementById('leave_emp')?.value||'';
  const leaveStart=normalizeIsoDate(document.getElementById('leave_start')?.value||'');
  const returnDate=normalizeIsoDate(document.getElementById('leave_return')?.value||'');
  if(!employeeId||!leaveStart||!returnDate){
    toast('warn', t('work_leave'), t('fill_all'));
    return;
  }
  if(leaveStart>returnDate){
    toast('warn', t('work_leave'), t('leave_invalid_dates'));
    return;
  }
  const payload={employee_id:employeeId, leave_start_date:leaveStart, return_date:returnDate};
  try{
    if(employeeLeavesTableAvailable){
      const {error}=await sb.from('employee_leaves').insert(payload);
      if(error){
        if(/employee_leaves|relation/i.test(error.message||'')){
          employeeLeavesTableAvailable=false;
          saveLocalEmployeeLeave(payload);
          toast('warn', t('work_leave'), t('leave_table_missing'));
        }else{
          throw error;
        }
      }
    }else{
      saveLocalEmployeeLeave(payload);
    }
    document.getElementById('leave_emp').value='';
    document.getElementById('leave_start').value='';
    document.getElementById('leave_return').value='';
    toast('success', t('work_leave'), t('leave_save_success'));
    await loadEmployeeLeaveAdminList();
    await loadTodayWorkLeaveCard();
    await loadAtt();
    loadDashboard();
    if(mVisible)loadMonthly();
  }catch(e){
    toast('error', t('work_leave'), e.message||t('leave_save_error'));
  }
}
async function removeEmployeeLeave(id, source='remote'){
  if(!id)return;
  try{
    if(source==='local' || String(id).startsWith('local_') || !employeeLeavesTableAvailable){
      const rows=getLocalEmployeeLeaves().filter(row=>String(row.id)!==String(id));
      setLocalEmployeeLeaves(rows);
    }else{
      const {error}=await sb.from('employee_leaves').delete().eq('id', id);
      if(error){
        if(/employee_leaves|relation/i.test(error.message||'')){
          employeeLeavesTableAvailable=false;
          const rows=getLocalEmployeeLeaves().filter(row=>String(row.id)!==String(id));
          setLocalEmployeeLeaves(rows);
        }else{
          throw error;
        }
      }
    }
    toast('success', t('work_leave'), t('leave_delete_success'));
    await loadEmployeeLeaveAdminList();
    await loadTodayWorkLeaveCard();
    await loadAtt();
    loadDashboard();
    if(mVisible)loadMonthly();
  }catch(e){
    toast('error', t('work_leave'), e.message||t('leave_delete_error'));
  }
}
function getAbsenceStartDate(){
  let ds=localStorage.getItem(ABSENCE_START_KEY);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ds||'')){
    ds=todayISO();
    localStorage.setItem(ABSENCE_START_KEY,ds);
  }
  return ds;
}
function addDaysISO(ds,days){
  const d=new Date(ds+'T12:00:00');
  d.setDate(d.getDate()+days);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function monthEndISO(month){
  const[y,mo]=month.split('-').map(Number);
  return `${month}-${String(new Date(y,mo,0).getDate()).padStart(2,'0')}`;
}
function isAbsenceReadyDate(ds){
  const today=todayISO();
  if(ds<today)return true;
  if(ds>today)return false;
  return getTzTotalMinutes()>=AUTO_END_HOUR*60+AUTO_END_MIN;
}
function countAbsencesForMonth(month,cameDates,leaveDates=new Set()){
  const start=[`${month}-01`,getAbsenceStartDate()].sort().pop();
  const end=[monthEndISO(month),todayISO()].sort()[0];
  if(start>end)return 0;
  let cnt=0;
  for(let ds=start;ds<=end;ds=addDaysISO(ds,1)){
    if(isWorkDay(ds)&&isAbsenceReadyDate(ds)&&!cameDates.has(ds)&&!leaveDates.has(ds))cnt++;
  }
  return cnt;
}
function getAbsenceDatesForMonth(month,cameDates,leaveDates=new Set()){
  const start=[`${month}-01`,getAbsenceStartDate()].sort().pop();
  const end=[monthEndISO(month),todayISO()].sort()[0];
  const dates=[];
  if(start>end)return dates;
  for(let ds=start;ds<=end;ds=addDaysISO(ds,1)){
    if(isWorkDay(ds)&&isAbsenceReadyDate(ds)&&!cameDates.has(ds)&&!leaveDates.has(ds))dates.push(ds);
  }
  return dates;
}
function updateDates(){const s=t('today')+': '+fmtD(tzNow());st('admDate',s);st('empDate',s);}
setInterval(updateDates,30000);

function isEditableTarget(target){
  return !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
}
function blockClipboardEvent(e){
  return true;
}
function disableClipboardFeatures(){
  disableClipboardFeatures.bound = true;
}
disableClipboardFeatures();

// ============================================================
