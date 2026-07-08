//  ADMIN
// ============================================================
let mVisible = false;
let monthlyData = [];
let monthlyAttendanceSummary = [];
let currentAdminTab = 'main';

function initAdmin(){adminTab('main');setToday();setCurMonth();updateDates();updateHolList();updateIPList();loadGPSSettingsUI();loadFaceControlSettings();loadMyIPDisplay();loadNotifEmpSelect();checkFeedbackBadge();subscribeAdminRealtime();loadTodayWorkLeaveCard();}

let _pbxAutoRefreshTimer = null;
function startPbxAutoRefresh() {
  if (_pbxAutoRefreshTimer) clearInterval(_pbxAutoRefreshTimer);
  // Har 60 soniyada PBX widget'ni yangilab tur
  _pbxAutoRefreshTimer = setInterval(() => {
    if (currentAdminTab === 'pbx')  loadPbxStats();
  }, 60000);
}
async function loadMyIPDisplay(){if(!userPublicIP)userPublicIP=await getUserIP();const el=document.getElementById('my_ip_show');if(el)el.textContent=userPublicIP||'—';refreshStaticLabels();}
async function loadNotifEmpSelect(){
  const{data:emps}=await sb.from('employees').select('id,name');
  const sel=document.getElementById('ns_emp');if(!sel)return;
  sel.innerHTML=`<option value="all">${t('notif_send_all')}</option>`;
  (emps||[]).forEach(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=e.name;sel.appendChild(o);});
}
async function checkFeedbackBadge(){
  const{data}=await sb.from('feedback').select('id').eq('status','new');
  const badge=document.getElementById('fbBadge');
  if(badge){const c=(data||[]).length;badge.textContent=c;badge.classList.toggle('hidden',c===0);}
}
function adminTab(tab){
  if(tab==='amocrm' && !ENABLE_AMOCRM)tab='main';
  if(tab==='pbx' && !ENABLE_ONLINEPBX)tab='main';
  currentAdminTab = tab;
  ['main','notif','feedback','settings','amocrm','pbx'].forEach(n=>{const el=document.getElementById('tab_'+n);if(el)el.classList.toggle('hidden',n!==tab || (n==='amocrm'&&!ENABLE_AMOCRM) || (n==='pbx'&&!ENABLE_ONLINEPBX));});
  ['nav_main','nav_amocrm','nav_feedback','nav_notif','nav_settings','nav_pbx'].forEach((id,i)=>{const name=['main','amocrm','feedback','notif','settings','pbx'][i];const el=document.getElementById(id);if(el){el.classList.toggle('hidden',(name==='amocrm'&&!ENABLE_AMOCRM)||(name==='pbx'&&!ENABLE_ONLINEPBX));el.classList.toggle('active',name===tab);}});
  if(tab==='pbx' && ENABLE_ONLINEPBX) loadPbxStats();
  st('admTitle',getAdminTabTitle(tab));
  if(tab!=='amocrm' && tab!=='main')stopAmoCrmTaskPage();
  if(tab==='settings'){loadEmpList();updateIPList();loadGPSSettingsUI();loadFaceControlSettings();}
  if(tab==='feedback')loadFeedbackAdmin();
  if(tab==='notif'){loadNotificationsAdmin();loadNotifEmpSelect();}
  if(tab==='amocrm' && ENABLE_AMOCRM)startAmoCrmTaskPage();
  animateCurrentView();
}
function setToday(){const today=todayISO();document.getElementById('fd_from').value=today;document.getElementById('fd_to').value=today;loadAtt();}
function setCurMonth(){document.getElementById('fmonth').value=curM();onAdminMonthChange();}
function onAdminMonthChange(){loadDashboard();loadMonthly();}
function refreshAdminMain(){loadAtt();loadDashboard();loadMonthly();loadTodayWorkLeaveCard();}
let amoCrmDepartmentRows = [];
let amoCrmTaskCounts = {total:0, overdue:0, onTime:0, updatedAt:null};
let amoCrmStatsLoading = false;
let amoCrmStatsLoaded = false;
let amoCrmStatsRequestId = 0;

function amoCrmSafeCount(value){
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function setAmoCrmError(id, msg=''){
  const el=document.getElementById(id);
  if(!el)return;
  el.textContent=msg;
  el.classList.toggle('hidden', !msg);
}
function setAmoCrmSummaryLoading(){
  [
    'amocrm_total_active','amocrm_total_overdue','amocrm_total_on_time_active'
  ].forEach(id=>st(id,'...'));
  st('amocrm_last_updated','-');
  renderAmoCrmDepartmentLoading();
  const empty=document.getElementById('amocrm_empty');
  if(empty)empty.classList.add('hidden');
}
function renderAmoCrmSummary(){
  if(amoCrmStatsLoading){
    setAmoCrmSummaryLoading();
    return;
  }
  st('amocrm_total_active', amoCrmTaskCounts.total);
  st('amocrm_total_overdue', amoCrmTaskCounts.overdue);
  st('amocrm_total_on_time_active', amoCrmTaskCounts.onTime);
  const note=document.getElementById('amocrm_table_note');
  if(note)note.textContent=t('amocrm_click_hint');
  const updated=document.getElementById('amocrm_last_updated');
  if(updated){
    updated.textContent=amoCrmTaskCounts.updatedAt
      ? `${t('amocrm_last_updated')}: ${fmtD(amoCrmTaskCounts.updatedAt)} ${fmtHM(amoCrmTaskCounts.updatedAt)}`
      : '-';
  }
}
function parseAmoCrmDeadline(value){
  if(value===null || value===undefined || value==='')return null;
  if(typeof value==='number'){
    const d=new Date(value > 100000000000 ? value : value*1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const text=String(value);
  if(/^\d+$/.test(text)){
    const n=Number(text);
    const d=new Date(n > 100000000000 ? n : n*1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d=new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}
function formatAmoCrmDeadline(value){
  const d=parseAmoCrmDeadline(value);
  return d ? `${fmtD(d)}, ${fmtHM(d)}` : t('amocrm_no_deadline');
}
function getAmoCrmDepartmentStatus(row){
  const active=amoCrmSafeCount(row?.active_tasks);
  const overdue=amoCrmSafeCount(row?.overdue_tasks);
  if(active===0)return {cls:'neutral', text:t('amocrm_status_no_active')};
  if(overdue>0)return {cls:'red', text:t('amocrm_status_overdue')};
  return {cls:'green', text:t('amocrm_status_on_time')};
}
function createAmoCrmStatusBadge(status){
  const badge=document.createElement('span');
  badge.className=`amocrm-status ${status.cls}`;
  badge.textContent=status.text;
  return badge;
}
function renderAmoCrmDepartmentLoading(){
  const grid=document.getElementById('amocrm_department_grid');
  if(!grid)return;
  grid.innerHTML='';
  for(let i=0;i<6;i++){
    const card=document.createElement('div');
    card.className='amocrm-dept-card';
    ['','short','','short'].forEach(cls=>{
      const skel=document.createElement('div');
      skel.className=`amocrm-skel ${cls}`.trim();
      skel.style.marginBottom='10px';
      card.appendChild(skel);
    });
    grid.appendChild(card);
  }
}
function addAmoCrmDepartmentMetric(parent, label, value){
  const box=document.createElement('div');
  box.className='amocrm-dept-metric';
  const l=document.createElement('span');
  l.textContent=label;
  const v=document.createElement('strong');
  v.textContent=String(amoCrmSafeCount(value));
  box.appendChild(l);
  box.appendChild(v);
  parent.appendChild(box);
}
function renderAmoCrmDepartments(){
  const grid=document.getElementById('amocrm_department_grid');
  const empty=document.getElementById('amocrm_empty');
  if(!grid)return;
  grid.innerHTML='';
  const hasRows=amoCrmDepartmentRows.length>0;
  if(empty)empty.classList.toggle('hidden', hasRows || !amoCrmStatsLoaded);
  if(!hasRows)return;
  amoCrmDepartmentRows.forEach(row=>{
    const departmentId=row.responsible_user_id;
    const card=document.createElement('div');
    card.className='amocrm-dept-card';
    if(departmentId!==null && departmentId!==undefined)card.dataset.id=String(departmentId);

    const top=document.createElement('div');
    top.className='amocrm-dept-top';
    const titleWrap=document.createElement('div');
    const name=document.createElement('div');
    name.className='amocrm-dept-name';
    name.textContent=row.department_name || '-';
    const active=document.createElement('div');
    active.className='amocrm-dept-active';
    active.textContent=String(amoCrmSafeCount(row.active_tasks));
    const activeLabel=document.createElement('div');
    activeLabel.className='amocrm-dept-active-label';
    activeLabel.textContent=t('amocrm_department_active');
    titleWrap.appendChild(name);
    titleWrap.appendChild(active);
    titleWrap.appendChild(activeLabel);
    top.appendChild(titleWrap);
    top.appendChild(createAmoCrmStatusBadge(getAmoCrmDepartmentStatus(row)));

    const metrics=document.createElement('div');
    metrics.className='amocrm-dept-metrics';
    addAmoCrmDepartmentMetric(metrics, t('amocrm_department_overdue'), row.overdue_tasks);
    addAmoCrmDepartmentMetric(metrics, t('amocrm_department_on_time'), row.on_time_tasks);

    const deadline=document.createElement('div');
    deadline.className='amocrm-dept-deadline';
    const label=document.createElement('span');
    label.textContent=`${t('amocrm_nearest_deadline')}: `;
    const value=document.createElement('strong');
    value.textContent=formatAmoCrmDeadline(row.nearest_deadline);
    deadline.appendChild(label);
    deadline.appendChild(value);

    card.appendChild(top);
    card.appendChild(metrics);
    card.appendChild(deadline);
    grid.appendChild(card);
  });
}
function renderAmoCrmTaskPage(){
  refreshAmoCrmStaticLabels();
  renderAmoCrmSummary();
  if(!amoCrmStatsLoading)renderAmoCrmDepartments();
}
async function loadAmoCrmDepartmentCounts({showLoading=true}={}){
  const requestId=++amoCrmStatsRequestId;
  const btn=document.getElementById('amocrm_refresh_btn');
  if(showLoading){
    amoCrmStatsLoading=true;
    if(btn)btn.disabled=true;
    setAmoCrmError('amocrm_error','');
    renderAmoCrmTaskPage();
  }
  try{
    const {data,error}=await fetchAmoCrmDepartmentTaskCounts();
    if(error)throw error;
    if(requestId!==amoCrmStatsRequestId)return;
    const rows=Array.isArray(data) ? data : [];
    const total=rows.reduce((sum,row)=>sum+amoCrmSafeCount(row.active_tasks),0);
    const overdue=rows.reduce((sum,row)=>sum+amoCrmSafeCount(row.overdue_tasks),0);
    const onTime=rows.reduce((sum,row)=>sum+amoCrmSafeCount(row.on_time_tasks),0);
    amoCrmDepartmentRows=rows;
    amoCrmTaskCounts={
      total,
      overdue,
      onTime,
      updatedAt:new Date()
    };
    amoCrmStatsLoaded=true;
    setAmoCrmError('amocrm_error','');
  }catch(e){
    if(requestId!==amoCrmStatsRequestId)return;
    console.error('loadAmoCrmDepartmentCounts error:', e);
    amoCrmDepartmentRows=[];
    amoCrmTaskCounts={total:0, overdue:0, onTime:0, updatedAt:null};
    amoCrmStatsLoaded=true;
    setAmoCrmError('amocrm_error', e.message || t('amocrm_stats_error'));
    toast('error', t('error_title'), t('amocrm_stats_error'));
  }finally{
    if(requestId===amoCrmStatsRequestId){
      amoCrmStatsLoading=false;
      if(btn)btn.disabled=false;
      renderAmoCrmTaskPage();
    }
  }
}
async function loadAmoCrmTaskStats(opts={}){
  return loadAmoCrmDepartmentCounts(opts);
}

// ============================================================
//  ONLINEPBX CALLS
// ============================================================
/**
 * @typedef {Object} OnlinePbxCallsResponse
 * @property {boolean} ok
 * @property {string=} source
 * @property {Object} filters
 * @property {{total:number,incoming:number,outgoing:number,internal:number,outsideWork:number,missed:number,answered:number,totalDuration:number,averageDuration:number,notCalledBack:number,notReached:number,withQualityScore:number,unknown:number,callback:number}} stats
 * @property {{limit:number,offset:number,returned:number,totalFiltered:number,hasNext:boolean,hasPrev:boolean}=} pagination
 * @property {Array<{id:string|null,date:string|null,direction:string|null,status:string|null,from_number:string|null,to_number:string|null,duration:number,recording_url:string|null,course_code?:string|null,course_label?:string,raw?:any}>} calls
 */
const ONLINE_PBX_FUNCTION_NAME = 'onlinepbx';
const ONLINE_PBX_ERROR_MESSAGE = "Qo'ng'iroqlarni yuklashda xatolik yuz berdi";
const ONLINE_PBX_DEFAULT_FILTERS = {
  dateFrom: '',
  dateTo: '',
  direction: 'all',
  status: 'all',
  phone: '',
  course: 'all',
  limit: 100,
  offset: 0
};
const ONLINE_PBX_CHART_PAGE_LIMIT = 1000;
const ONLINE_PBX_CHART_MAX_PAGES = 60;
const ONLINE_PBX_FETCH_LIMIT = 20000;
const PBX_TEXT = {
  uz: {
    pageTitle: "PBX qo'ng'iroqlari",
    navCalls: "Qo'ng'iroqlar",
    pageSubtitle: "OnlinePBX ma'lumotlari faqat Supabase Edge Function orqali yuklanadi.",
    dashboardTitle: "Kurs kesimidagi qo'ng'iroqlar",
    details: "Batafsil",
    responsiblesTitle: "Kurs mas'ullari",
    all: "Barchasi",
    total: "Jami",
    totalCalls: "Jami qo'ng'iroqlar",
    incoming: "Kiruvchi",
    outgoing: "Chiquvchi",
    internal: "Ichki",
    outsideWork: "Ishdan tashqari qo'ng'iroqlar",
    missed: "Yetib bormagan",
    notCalledBack: "Qayta qo'ng'iroq qilinmagan",
    notCalledBackShort: "Qayta qilinmagan",
    unknown: "Aniqlanmadi",
    quality: "Baholangan",
    answered: "Gaplashilgan",
    answeredFilter: "Javob berilgan",
    courseCalls: "Kurs kesimidagi qo'ng'iroqlar",
    hourlyCalls: "Soat bo'yicha qo'ng'iroqlar",
    loading: "Yuklanmoqda...",
    chartLoading: "Diagramma yuklanmoqda...",
    fullApiLoading: "To'liq API ma'lumotlari yuklanmoqda",
    noCourseCalls: "Kurs kesimida qo'ng'iroqlar topilmadi",
    noHourCalls: "Soat bo'yicha qo'ng'iroqlar topilmadi",
    noCalls: "Qo'ng'iroqlar topilmadi",
    callsCount: "ta qo'ng'iroq",
    totalLabel: "jami",
    today: "Bugun",
    todayView: "Bugungi ko'rinish",
    rangeToday: "Bugungi kun",
    rangeHintDefault: "Tanlanmasa bugungi kun ma'lumoti yuklanadi",
    rangeHintSelect: "Sana tanlang",
    rangeHintEnd: "Yakun sanani tanlang yoki shu sanani qayta bosing",
    rangeHintSelected: "Tanlangan sana diapazoni",
    updated: "Yangilangan",
    courses: "Kurslar",
    unassignedResponsible: "Mas'ul biriktirilmagan",
    most: "Eng ko'p",
    error: "Qo'ng'iroqlarni yuklashda xatolik yuz berdi"
  },
  ru: {
    pageTitle: "PBX звонки",
    navCalls: "Звонки",
    pageSubtitle: "Данные OnlinePBX загружаются только через Supabase Edge Function.",
    dashboardTitle: "Звонки по курсам",
    details: "Подробнее",
    responsiblesTitle: "Ответственные за курсы",
    all: "Все",
    total: "Итого",
    totalCalls: "Всего звонков",
    incoming: "Входящие",
    outgoing: "Исходящие",
    internal: "Внутренние",
    outsideWork: "Звонки вне рабочего времени",
    missed: "Недозвон",
    notCalledBack: "Не перезвонили",
    notCalledBackShort: "Не перезвонили",
    unknown: "Не определено",
    quality: "Оцененные",
    answered: "Разговоры",
    answeredFilter: "Отвеченные",
    courseCalls: "Звонки по курсам",
    hourlyCalls: "Звонки по часам",
    loading: "Загрузка...",
    chartLoading: "Диаграмма загружается...",
    fullApiLoading: "Загружаются полные данные API",
    noCourseCalls: "Звонки по курсам не найдены",
    noHourCalls: "Звонки по часам не найдены",
    noCalls: "Звонки не найдены",
    callsCount: "звонков",
    totalLabel: "всего",
    today: "Сегодня",
    todayView: "Вид за сегодня",
    rangeToday: "Сегодня",
    rangeHintDefault: "Если дата не выбрана, загружаются данные за сегодня",
    rangeHintSelect: "Выберите дату",
    rangeHintEnd: "Выберите конечную дату или нажмите эту дату еще раз",
    rangeHintSelected: "Выбранный диапазон дат",
    updated: "Обновлено",
    courses: "Курсы",
    unassignedResponsible: "Ответственный не назначен",
    most: "Больше всего",
    error: "Ошибка при загрузке звонков"
  },
  en: {
    pageTitle: "PBX calls",
    navCalls: "Calls",
    pageSubtitle: "OnlinePBX data is loaded only through the Supabase Edge Function.",
    dashboardTitle: "Calls by course",
    details: "Details",
    responsiblesTitle: "Course responsibles",
    all: "All",
    total: "Total",
    totalCalls: "Total calls",
    incoming: "Incoming",
    outgoing: "Outgoing",
    internal: "Internal",
    outsideWork: "Outside work calls",
    missed: "Not reached",
    notCalledBack: "Not called back",
    notCalledBackShort: "Not called back",
    unknown: "Unknown",
    quality: "Rated",
    answered: "Answered",
    answeredFilter: "Answered",
    courseCalls: "Calls by course",
    hourlyCalls: "Calls by hour",
    loading: "Loading...",
    chartLoading: "Chart loading...",
    fullApiLoading: "Full API data is loading",
    noCourseCalls: "No calls found by course",
    noHourCalls: "No calls found by hour",
    noCalls: "No calls found",
    callsCount: "calls",
    totalLabel: "total",
    today: "Today",
    todayView: "Today view",
    rangeToday: "Today",
    rangeHintDefault: "Today is loaded when no date is selected",
    rangeHintSelect: "Select date",
    rangeHintEnd: "Select an end date or click the same date again",
    rangeHintSelected: "Selected date range",
    updated: "Updated",
    courses: "Courses",
    unassignedResponsible: "No responsible assigned",
    most: "Most",
    error: "Could not load calls"
  }
};
const PBX_COURSE_MAP = {
  '105': '1-kurs',
  '103': '2-kurs',
  '101': '3-kurs',
  '100': '4-kurs',
  '102': '5-kurs',
  '104': 'Umumiy call'
};
const ONLINE_PBX_DASHBOARD_FILTERS = {
  all: {},
  incoming: { direction: 'incoming' },
  outgoing: { direction: 'outgoing' },
  answered: { status: 'answered' },
  missed: { status: 'missed' }
};
const ONLINE_PBX_PAGE_STAT_META = [
  { id: 'total', el: 'pbx_stat_total', labelKey: 'all', icon: 'Phone' },
  { id: 'incoming', el: 'pbx_stat_incoming', labelKey: 'incoming', icon: 'PhoneIncoming' },
  { id: 'outgoing', el: 'pbx_stat_outgoing', labelKey: 'outgoing', icon: 'PhoneOutgoing' },
  { id: 'outsideWork', el: 'pbx_stat_outside_work', labelKey: 'outsideWork', icon: 'Clock' },
  { id: 'missed', el: 'pbx_stat_missed', labelKey: 'missed', icon: 'PhoneMissed' },
  { id: 'notCalledBack', el: 'pbx_stat_not_called_back', labelKey: 'notCalledBack', icon: 'RotateCcw' },
  { id: 'unknown', el: 'pbx_stat_unknown', labelKey: 'unknown', icon: 'HelpCircle' },
  { id: 'withQualityScore', el: 'pbx_stat_with_quality_score', labelKey: 'quality', icon: 'Headphones' }
];
const PBX_COURSE_CHART_METRICS = [
  { id: 'total', labelKey: 'total', icon: 'Phone', color: 'var(--accent)' },
  { id: 'incoming', labelKey: 'incoming', icon: 'PhoneIncoming', color: 'var(--success)' },
  { id: 'outgoing', labelKey: 'outgoing', icon: 'PhoneOutgoing', color: 'var(--accent2)' },
  { id: 'missed', labelKey: 'missed', icon: 'PhoneMissed', color: 'var(--danger)' },
  { id: 'answered', labelKey: 'answered', icon: 'Headphones', color: 'var(--purple)' },
  { id: 'notCalledBack', labelKey: 'notCalledBackShort', icon: 'RotateCcw', color: 'var(--warn)' }
];
const PBX_UZ_MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
const PBX_LUCIDE_PATHS = {
  Phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.33 1.8.63 2.65a2 2 0 0 1-.45 2.11L8.09 9.69a16 16 0 0 0 6.22 6.22l1.21-1.21a2 2 0 0 1 2.11-.45c.85.3 1.74.51 2.65.63A2 2 0 0 1 22 16.92z"/>',
  PhoneCall: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.33 1.8.63 2.65a2 2 0 0 1-.45 2.11L8.09 9.69a16 16 0 0 0 6.22 6.22l1.21-1.21a2 2 0 0 1 2.11-.45c.85.3 1.74.51 2.65.63A2 2 0 0 1 22 16.92z"/><path d="M14.05 2a9 9 0 0 1 8 7.94"/><path d="M14.05 6A5 5 0 0 1 18 10"/>',
  PhoneIncoming: '<path d="M16 2v6h6"/><path d="m22 2-6 6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.33 1.8.63 2.65a2 2 0 0 1-.45 2.11L8.09 9.69a16 16 0 0 0 6.22 6.22l1.21-1.21a2 2 0 0 1 2.11-.45c.85.3 1.74.51 2.65.63A2 2 0 0 1 22 16.92z"/>',
  PhoneOutgoing: '<path d="M22 8V2h-6"/><path d="m16 8 6-6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.33 1.8.63 2.65a2 2 0 0 1-.45 2.11L8.09 9.69a16 16 0 0 0 6.22 6.22l1.21-1.21a2 2 0 0 1 2.11-.45c.85.3 1.74.51 2.65.63A2 2 0 0 1 22 16.92z"/>',
  PhoneMissed: '<path d="M22 8V2h-6"/><path d="m16 8 6-6"/><path d="m22 2-6 6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.33 1.8.63 2.65a2 2 0 0 1-.45 2.11L8.09 9.69a16 16 0 0 0 6.22 6.22l1.21-1.21a2 2 0 0 1 2.11-.45c.85.3 1.74.51 2.65.63A2 2 0 0 1 22 16.92z"/>',
  Clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  Calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  ChevronLeft: '<path d="m15 18-6-6 6-6"/>',
  ChevronRight: '<path d="m9 18 6-6-6-6"/>',
  ChevronDown: '<path d="m6 9 6 6 6-6"/>',
  Search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  RotateCcw: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  Loader2: '<path d="M21 12a9 9 0 1 1-6.2-8.56"/>',
  AlertCircle: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  HelpCircle: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.8 1c-.4.8-1 1.1-1.8 1.7-.7.5-1.1 1-1.1 2.3"/><path d="M12 17h.01"/>',
  BarChart3: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  Headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3H5a2 2 0 0 1-2-2v-3Z"/><path d="M21 14h-3a2 2 0 0 0-2 2v3h3a2 2 0 0 0 2-2v-3Z"/><path d="M3 14v-3a9 9 0 0 1 18 0v3"/>',
  PlayCircle: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8Z"/>'
};

let onlinePbxPageState = { loading: false, requestId: 0, filters: { ...ONLINE_PBX_DEFAULT_FILTERS }, data: null, error: null, lastLoadedAt: null, pagination: null };
let pbxCalendarMonth = null;
let pbxCalendarOpen = false;
let pbxCourseChartMetric = 'total';
let onlinePbxChartCalls = [];
let onlinePbxDashboardChartCalls = [];
let onlinePbxDashboardFilter = 'all';
let onlinePbxDashboardLoading = false;
let onlinePbxDashboardRequestId = 0;

function pbxText(key){
  const currentLang=(typeof lang==='string' && PBX_TEXT[lang]) ? lang : 'uz';
  return PBX_TEXT[currentLang]?.[key] ?? PBX_TEXT.uz[key] ?? key;
}
function pbxMetricLabel(metric){
  return pbxText(metric?.labelKey || metric?.id || '');
}
function setPbxTitleHtml(id, icon, text){
  const el=document.getElementById(id);
  if(el)el.innerHTML=pbxIcon(icon) + ' ' + escapePbxHtml(text);
}
function refreshPbxStaticLabels(){
  setPbxTitleHtml('pbx_page_title','PhoneCall',pbxText('pageTitle'));
  setPbxTitleHtml('pbx_responsibles_title','Headphones',pbxText('responsiblesTitle'));
  setPbxTitleHtml('pbx_course_chart_title','BarChart3',pbxText('courseCalls'));
  setPbxTitleHtml('pbx_hour_chart_title','Clock',pbxText('hourlyCalls'));
  st('pbx_page_subtitle',pbxText('pageSubtitle'));
  st('n_pbx',pbxText('navCalls'));
  const loaded=document.getElementById('pbx_loaded_at');
  if(loaded && /Bugungi|Сегодня|Today/i.test(loaded.textContent || ''))loaded.textContent=pbxText('todayView');
  ONLINE_PBX_PAGE_STAT_META.forEach(item=>{
    const card=document.getElementById(item.el)?.closest('.pbx-stat-card');
    const label=card?.querySelector('small');
    if(label)label.textContent=pbxText(item.labelKey);
  });
  hydratePbxIcons();
}
function pbxIcon(name, cls=''){
  const paths = PBX_LUCIDE_PATHS[name] || PBX_LUCIDE_PATHS.Phone;
  const extra = cls ? ' ' + cls : '';
  return '<span class="pbx-icon' + extra + '" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg></span>';
}
function hydratePbxIcons(root=document){
  if(!root)return;
  root.querySelectorAll('[data-pbx-icon]').forEach(el=>{ el.innerHTML=pbxIcon(el.getAttribute('data-pbx-icon') || 'Phone'); });
}
function onlinePbxNumber(value){const n=Number(value ?? 0);return Number.isFinite(n)?n:0;}
function onlinePbxLocale(){
  if(typeof lang==='string' && lang==='ru')return 'ru-RU';
  if(typeof lang==='string' && lang==='en')return 'en-US';
  return 'uz-UZ';
}
function onlinePbxFormatNumber(value){return new Intl.NumberFormat(onlinePbxLocale()).format(onlinePbxNumber(value));}
function escapePbxHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function formatOnlinePbxDuration(seconds=0){
  const total=Math.max(0,Math.floor(onlinePbxNumber(seconds)));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
  if(h>0)return h + 'h ' + m + 'm ' + s + 's';
  if(m>0)return m + 'm ' + s + 's';
  return s + 's';
}
function formatOnlinePbxDate(value){
  if(!value)return '-';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return String(value);
  return new Intl.DateTimeFormat(onlinePbxLocale(),{timeZone:TASHKENT_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);
}
function normalizePbxText(value){
  return value === null || value === undefined || value === '' ? null : String(value);
}
function getPbxCourseCodeFromLabel(label=''){
  const text=String(label||'').toLowerCase().trim();
  const found=Object.entries(PBX_COURSE_MAP).find(([,courseLabel])=>courseLabel.toLowerCase()===text);
  return found?.[0] || null;
}
function getPbxCourseCodeFromValue(value){
  const text=normalizePbxText(value);
  if(!text)return null;
  const trimmed=text.trim();
  if(PBX_COURSE_MAP[trimmed])return trimmed;
  const match=trimmed.match(/(?:^|\D)(100|101|102|103|104|105)(?:\D|$)/);
  return match?.[1] || null;
}
function getPbxCourseCandidates(call){
  const raw=call?.raw || {};
  const events=Array.isArray(raw.events) ? raw.events : [];
  return [
    call?.course_code,
    raw.course_code,
    raw.extension,
    raw.ext,
    raw.department_extension,
    raw.destination_number,
    raw.destination,
    raw.dst,
    raw.to_number,
    call?.to_number,
    raw.caller_id_number,
    raw.caller_id_name,
    raw.src,
    raw.from_number,
    call?.from_number,
    ...events.flatMap(event=>[
      event?.number,
      event?.extension,
      event?.destination_number,
      event?.caller_id_number,
      event?.caller_id_name
    ])
  ];
}
function getPbxCourseInfo(call){
  const directCode=normalizePbxText(call?.course_code);
  const directLabel=normalizePbxText(call?.course_label);
  const directCodeMatch=getPbxCourseCodeFromValue(directCode) || getPbxCourseCodeFromLabel(directCode);
  if(directCodeMatch){
    return { code: directCodeMatch, label: PBX_COURSE_MAP[directCodeMatch] };
  }
  const labelCode=getPbxCourseCodeFromLabel(directLabel);
  if(labelCode){
    return { code: labelCode, label: PBX_COURSE_MAP[labelCode] };
  }
  if(directCode || directLabel){
    return {
      code: directCode,
      label: directLabel || PBX_COURSE_MAP[directCode] || pbxText('unknown')
    };
  }

  for(const value of getPbxCourseCandidates(call)){
    const code=getPbxCourseCodeFromValue(value);
    if(code)return { code, label:PBX_COURSE_MAP[code] };
  }

  return { code:null, label:pbxText('unknown') };
}
function filterCallsByCourse(calls, course){
  if(!course || course==='all')return calls;
  return calls.filter(call=>getPbxCourseInfo(call).code===course);
}
function getOnlinePbxDirectionInfo(value){
  const direction=String(value || '').toLowerCase();
  if(direction.includes('inbound') || direction.includes('incoming') || direction==='in'){
    return { label:pbxText('incoming'), icon:'PhoneIncoming', key:'incoming' };
  }
  if(direction.includes('outbound') || direction.includes('outgoing') || direction==='out'){
    return { label:pbxText('outgoing'), icon:'PhoneOutgoing', key:'outgoing' };
  }
  if(direction.includes('internal')){
    return { label:pbxText('internal'), icon:'PhoneCall', key:'internal' };
  }
  return { label:value ? String(value) : '-', icon:'Phone', key:'' };
}
function getOnlinePbxStatusInfo(call){
  const duration=onlinePbxNumber(call?.duration);
  const status=String(call?.status || '').toLowerCase();
  if(status.includes('normal_clearing') && duration>0)return { label:pbxText('answered'), cls:'answered' };
  if(duration>0)return { label:pbxText('answered'), cls:'answered' };
  if(duration===0)return { label:pbxText('missed'), cls:'missed' };
  return { label:call?.status ? String(call.status) : '-', cls:'' };
}
function pbxDateFromIso(iso){
  const [year,month,day]=(iso || todayISO()).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0);
}
function pbxIsoFromDate(date){
  return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
}
function pbxMonthFromIso(iso=todayISO()){
  const date=pbxDateFromIso(iso);
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0);
}
function pbxAddDays(iso,days){
  const date=pbxDateFromIso(iso);
  date.setDate(date.getDate()+days);
  return pbxIsoFromDate(date);
}
function pbxMonthStartIso(date=pbxDateFromIso(todayISO())){
  return pbxIsoFromDate(new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0));
}
function pbxMonthEndIso(date=pbxDateFromIso(todayISO())){
  return pbxIsoFromDate(new Date(date.getFullYear(), date.getMonth()+1, 0, 12, 0, 0));
}
function pbxFormatIsoLabel(iso){
  if(!iso)return '';
  const date=pbxDateFromIso(iso);
  return String(date.getDate()).padStart(2,'0') + '.' + String(date.getMonth()+1).padStart(2,'0') + '.' + date.getFullYear();
}
function pbxNormalizeDateRange(dateFrom='',dateTo=''){
  const start=(dateFrom||'').trim();
  const end=(dateTo||'').trim();
  if(start && end && end<start)return { dateFrom:end, dateTo:start };
  return { dateFrom:start, dateTo:end };
}
function getPbxEffectiveChartFilters(filters={}){
  const normalized={...ONLINE_PBX_DEFAULT_FILTERS,...(filters||{})};
  const range=pbxNormalizeDateRange(normalized.dateFrom || '', normalized.dateTo || '');
  if(!range.dateFrom && !range.dateTo){
    const today=todayISO();
    return {...normalized,dateFrom:today,dateTo:today};
  }
  return {...normalized,dateFrom:range.dateFrom,dateTo:range.dateTo || range.dateFrom};
}
function getPbxRangeNote(filters=onlinePbxPageState.filters || ONLINE_PBX_DEFAULT_FILTERS){
  const start=(filters.dateFrom || '').trim();
  const end=(filters.dateTo || '').trim();
  if(!start && !end)return pbxText('today');
  if(start && (!end || start===end))return pbxFormatIsoLabel(start);
  return pbxFormatIsoLabel(start) + ' - ' + pbxFormatIsoLabel(end);
}
function updatePbxRangeSummary(){
  const text=document.getElementById('pbx_range_text');
  const hint=document.getElementById('pbx_range_hint');
  if(!text && !hint)return;
  const filters=onlinePbxPageState.filters || ONLINE_PBX_DEFAULT_FILTERS;
  const start=filters.dateFrom || '';
  const end=filters.dateTo || '';
  if(!start && !end){
    if(text)text.textContent=pbxText('rangeToday');
    if(hint)hint.textContent=pbxText('rangeHintDefault');
    return;
  }
  if(start && !end){
    if(text)text.textContent=pbxFormatIsoLabel(start);
    if(hint)hint.textContent=pbxText('rangeHintEnd');
    return;
  }
  if(text)text.textContent=start===end ? pbxFormatIsoLabel(start) : pbxFormatIsoLabel(start) + ' - ' + pbxFormatIsoLabel(end);
  if(hint)hint.textContent=pbxText('rangeHintSelected');
}
function setPbxCalendarOpen(open){
  pbxCalendarOpen=!!open;
  const picker=document.getElementById('pbx_date_picker');
  const trigger=document.getElementById('pbx_date_trigger');
  if(picker)picker.classList.toggle('open',pbxCalendarOpen);
  if(trigger)trigger.setAttribute('aria-expanded', pbxCalendarOpen ? 'true' : 'false');
  if(pbxCalendarOpen)renderPbxCalendar();
}
function togglePbxCalendar(){setPbxCalendarOpen(!pbxCalendarOpen);}
function renderPbxCalendar(){
  const grid=document.getElementById('pbx_calendar_grid');
  const title=document.getElementById('pbx_calendar_title');
  if(!grid)return;
  if(!pbxCalendarMonth)pbxCalendarMonth=pbxMonthFromIso(todayISO());
  const month=pbxCalendarMonth;
  if(title)title.textContent=PBX_UZ_MONTHS[month.getMonth()] + ' ' + month.getFullYear();
  const firstDay=new Date(month.getFullYear(), month.getMonth(), 1, 12, 0, 0);
  const mondayOffset=(firstDay.getDay()+6)%7;
  const gridStart=new Date(firstDay);
  gridStart.setDate(firstDay.getDate()-mondayOffset);
  const filters=onlinePbxPageState.filters || ONLINE_PBX_DEFAULT_FILTERS;
  const isDefaultToday=!(filters.dateFrom || filters.dateTo);
  const start=isDefaultToday ? todayISO() : (filters.dateFrom || '');
  const end=filters.dateTo || '';
  const effectiveEnd=end || start;
  const today=todayISO();
  grid.innerHTML='';
  for(let i=0;i<42;i++){
    const day=new Date(gridStart);
    day.setDate(gridStart.getDate()+i);
    const iso=pbxIsoFromDate(day);
    const inMonth=day.getMonth()===month.getMonth();
    const selected=iso===start || iso===end;
    const inRange=start && effectiveEnd && iso>=start && iso<=effectiveEnd;
    const btn=document.createElement('button');
    btn.type='button';
    btn.className=[
      'pbx-day',
      inMonth ? '' : 'outside',
      iso===today ? 'today' : '',
      selected ? 'selected' : '',
      inRange ? 'in-range' : '',
      iso===start ? 'range-start' : '',
      iso===end ? 'range-end' : ''
    ].filter(Boolean).join(' ');
    btn.textContent=String(day.getDate());
    btn.setAttribute('aria-label', pbxFormatIsoLabel(iso));
    btn.addEventListener('click', event=>{
      event.stopPropagation();
      selectPbxCalendarDate(iso);
    });
    grid.appendChild(btn);
  }
}
function setOnlinePbxFilterInputs(filters=ONLINE_PBX_DEFAULT_FILTERS){
  const normalized={...ONLINE_PBX_DEFAULT_FILTERS,...(filters||{})};
  const range=pbxNormalizeDateRange(normalized.dateFrom || '', normalized.dateTo || '');
  normalized.dateFrom=range.dateFrom;
  normalized.dateTo=range.dateTo;
  normalized.direction=normalized.direction || 'all';
  normalized.status=normalized.status || 'all';
  normalized.course=normalized.course || 'all';
  normalized.phone=normalized.phone || '';
  normalized.limit=Number.isFinite(Number(normalized.limit)) ? Number(normalized.limit) : ONLINE_PBX_DEFAULT_FILTERS.limit;
  normalized.offset=Number.isFinite(Number(normalized.offset)) ? Number(normalized.offset) : 0;
  onlinePbxPageState.filters={...normalized};
  const fields={
    pbx_date_from:normalized.dateFrom,
    pbx_date_to:normalized.dateTo,
    pbx_phone:normalized.phone,
    pbx_course:normalized.course,
    pbx_direction:normalized.direction,
    pbx_status:normalized.status
  };
  Object.entries(fields).forEach(([id,value])=>{
    const el=document.getElementById(id);
    if(el)el.value=value;
  });
  pbxCalendarMonth=pbxMonthFromIso(range.dateFrom || range.dateTo || todayISO());
  renderPbxCalendar();
  updatePbxRangeSummary();
}
function selectPbxCalendarDate(iso){
  const current=onlinePbxPageState.filters || ONLINE_PBX_DEFAULT_FILTERS;
  let range;
  if(!current.dateFrom || current.dateTo){
    range={ dateFrom:iso, dateTo:'' };
  }else{
    range=pbxNormalizeDateRange(current.dateFrom, iso);
  }
  setOnlinePbxFilterInputs(range);
  if(range.dateFrom && range.dateTo){
    setPbxCalendarOpen(false);
    loadPbxStats({filters:{...readOnlinePbxFilters(),offset:0}});
  }else{
    setPbxCalendarOpen(true);
  }
}
function movePbxCalendar(delta){
  if(!pbxCalendarMonth)pbxCalendarMonth=pbxMonthFromIso(todayISO());
  pbxCalendarMonth=new Date(pbxCalendarMonth.getFullYear(), pbxCalendarMonth.getMonth()+Number(delta||0), 1, 12, 0, 0);
  renderPbxCalendar();
  updatePbxRangeSummary();
}
function setPbxDatePreset(preset){
  const today=todayISO();
  const todayDate=pbxDateFromIso(today);
  let range={ dateFrom:today, dateTo:today };
  if(preset==='week' || preset==='last_week'){
    range={ dateFrom:pbxAddDays(today,-6), dateTo:today };
  }else if(preset==='previous_week'){
    range={ dateFrom:pbxAddDays(today,-13), dateTo:pbxAddDays(today,-7) };
  }else if(preset==='current_month'){
    range={ dateFrom:pbxMonthStartIso(todayDate), dateTo:today };
  }else if(preset==='last_month'){
    const lastMonth=new Date(todayDate.getFullYear(), todayDate.getMonth()-1, 1, 12, 0, 0);
    range={ dateFrom:pbxMonthStartIso(lastMonth), dateTo:pbxMonthEndIso(lastMonth) };
  }
  setOnlinePbxFilterInputs(range);
  setPbxCalendarOpen(false);
  loadPbxStats({filters:{...readOnlinePbxFilters(),offset:0}});
}
function readPbxInputValue(id, fallback=''){
  const el=document.getElementById(id);
  return el ? (el.value || '').trim() : fallback;
}
function readOnlinePbxFilters(){
  const current=onlinePbxPageState.filters || ONLINE_PBX_DEFAULT_FILTERS;
  const range=pbxNormalizeDateRange(
    readPbxInputValue('pbx_date_from', current.dateFrom || ''),
    readPbxInputValue('pbx_date_to', current.dateTo || '')
  );
  if(range.dateFrom && !range.dateTo)range.dateTo=range.dateFrom;
  return {
    ...ONLINE_PBX_DEFAULT_FILTERS,
    ...range,
    phone:readPbxInputValue('pbx_phone', current.phone || ''),
    course:readPbxInputValue('pbx_course', current.course || 'all') || 'all',
    direction:readPbxInputValue('pbx_direction', current.direction || 'all') || 'all',
    status:readPbxInputValue('pbx_status', current.status || 'all') || 'all',
    limit:ONLINE_PBX_DEFAULT_FILTERS.limit,
    offset:0
  };
}
function getPbxCallLocalMinutes(value){
  if(!value)return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:TASHKENT_TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date);
  let hour=Number(parts.find(part=>part.type==='hour')?.value);
  const minute=Number(parts.find(part=>part.type==='minute')?.value);
  if(!Number.isFinite(hour) || !Number.isFinite(minute))return null;
  if(hour===24)hour=0;
  return hour * 60 + minute;
}
function isPbxOutsideWorkCall(call={}){
  const minutes=getPbxCallLocalMinutes(call.date);
  if(minutes===null)return false;
  return minutes < WORKDAY_START_MINUTES || minutes >= WORKDAY_END_MINUTES;
}
function isPbxUnknownCourse(call={}){
  const info=getPbxCourseInfo(call);
  return !info.code || !PBX_COURSE_MAP[info.code];
}
function normalizeOnlinePbxCall(call={}){
  const raw=call?.raw || {};
  const normalized={
    id:call.id ?? raw.id ?? raw.uuid ?? null,
    date:call.date ?? raw.date ?? raw.start_stamp ?? raw.created_at ?? null,
    direction:call.direction ?? raw.direction ?? raw.accountcode ?? null,
    status:call.status ?? raw.status ?? raw.disposition ?? raw.hangup_cause ?? null,
    from_number:call.from_number ?? raw.from_number ?? raw.caller_id_number ?? raw.src ?? null,
    to_number:call.to_number ?? raw.to_number ?? raw.destination_number ?? raw.destination ?? raw.dst ?? null,
    duration:onlinePbxNumber(call.duration ?? raw.duration ?? raw.billsec ?? raw.talk_time),
    recording_url:call.recording_url ?? raw.recording_url ?? raw.recording ?? raw.record_url ?? null,
    course_code:call.course_code ?? raw.course_code ?? null,
    course_label:call.course_label ?? raw.course_label ?? null,
    raw
  };
  const course=getPbxCourseInfo(normalized);
  normalized.course_code=course.code;
  normalized.course_label=course.label;
  return normalized;
}
function getPbxCallStatFlags(call={}){
  const direction=String(call.direction || '').toLowerCase();
  const status=String(call.status || '').toLowerCase();
  const duration=onlinePbxNumber(call.duration || 0);
  const raw=call.raw || {};
  const accountcode=String(raw.accountcode || direction).toLowerCase();
  const incoming=
    direction.includes('inbound') ||
    direction.includes('incoming') ||
    direction==='in' ||
    accountcode.includes('inbound');
  const outgoing=
    direction.includes('outbound') ||
    direction.includes('outgoing') ||
    direction==='out' ||
    accountcode.includes('outbound');
  const internal=
    direction.includes('internal') ||
    accountcode.includes('internal');
  const missed=
    duration===0 ||
    status.includes('miss') ||
    status.includes('no_answer') ||
    status.includes('noanswer') ||
    status.includes('busy') ||
    status.includes('cancel') ||
    status.includes('fail');
  const answered=!missed && duration>0;
  return {
    duration,
    incoming,
    outgoing,
    internal,
    missed,
    answered,
    withQualityScore:onlinePbxNumber(raw.quality_score || call.quality_score)>0,
    callback:accountcode.includes('callback') || status.includes('callback'),
    unknown:isPbxUnknownCourse(call),
    outsideWork:isPbxOutsideWorkCall(call),
    notReached:outgoing && duration===0,
    notCalledBack:incoming && missed && !raw.callback_at && !raw.called_back_at
  };
}
function computePbxStats(calls=[], apiStats={}){
  const has=key=>apiStats && apiStats[key] !== undefined && apiStats[key] !== null;
  const computed={
    total:calls.length,
    incoming:0,
    outgoing:0,
    internal:0,
    missed:0,
    answered:0,
    totalDuration:0,
    averageDuration:0,
    notCalledBack:0,
    notReached:0,
    outsideWork:0,
    unknown:0,
    withQualityScore:0,
    callback:0
  };

  for(const call of calls){
    const flags=getPbxCallStatFlags(call);
    if(flags.incoming)computed.incoming+=1;
    if(flags.outgoing)computed.outgoing+=1;
    if(flags.internal)computed.internal+=1;
    if(flags.missed)computed.missed+=1;
    if(flags.answered)computed.answered+=1;

    computed.totalDuration+=flags.duration;

    if(flags.withQualityScore)computed.withQualityScore+=1;
    if(flags.callback)computed.callback+=1;
    if(flags.unknown)computed.unknown+=1;
    if(flags.outsideWork)computed.outsideWork+=1;
    if(flags.notReached)computed.notReached+=1;
    if(flags.notCalledBack)computed.notCalledBack+=1;
  }

  computed.averageDuration=computed.total ? Math.round(computed.totalDuration / computed.total) : 0;

  return {
    total:has('total') ? onlinePbxNumber(apiStats.total) : computed.total,
    incoming:has('incoming') ? onlinePbxNumber(apiStats.incoming) : computed.incoming,
    outgoing:has('outgoing') ? onlinePbxNumber(apiStats.outgoing) : computed.outgoing,
    internal:has('internal') ? onlinePbxNumber(apiStats.internal) : computed.internal,
    missed:has('missed') ? onlinePbxNumber(apiStats.missed) : computed.missed,
    answered:has('answered') ? onlinePbxNumber(apiStats.answered) : computed.answered,
    totalDuration:has('totalDuration') ? onlinePbxNumber(apiStats.totalDuration) : computed.totalDuration,
    averageDuration:has('averageDuration') ? onlinePbxNumber(apiStats.averageDuration) : computed.averageDuration,
    notCalledBack:has('notCalledBack') ? onlinePbxNumber(apiStats.notCalledBack) : computed.notCalledBack,
    notReached:has('notReached') ? onlinePbxNumber(apiStats.notReached) : computed.notReached,
    outsideWork:has('outsideWork') ? onlinePbxNumber(apiStats.outsideWork) : computed.outsideWork,
    unknown:has('unknown') ? onlinePbxNumber(apiStats.unknown) : computed.unknown,
    withQualityScore:has('withQualityScore') ? onlinePbxNumber(apiStats.withQualityScore) : computed.withQualityScore,
    callback:has('callback') ? onlinePbxNumber(apiStats.callback) : computed.callback
  };
}
function normalizeOnlinePbxPagination(pagination, calls=[], filters={}){
  const limit=Math.max(1,onlinePbxNumber(pagination?.limit ?? filters.limit ?? ONLINE_PBX_DEFAULT_FILTERS.limit) || ONLINE_PBX_DEFAULT_FILTERS.limit);
  const offset=Math.max(0,onlinePbxNumber(pagination?.offset ?? filters.offset ?? 0));
  const returned=onlinePbxNumber(pagination?.returned ?? calls.length);
  const fallbackTotal=Math.max(offset + returned, calls.length);
  const totalFiltered=onlinePbxNumber(pagination?.totalFiltered ?? pagination?.total ?? filters.totalFiltered ?? fallbackTotal);
  return {
    limit,
    offset,
    returned,
    totalFiltered,
    hasNext:pagination?.hasNext !== undefined ? !!pagination.hasNext : returned >= limit,
    hasPrev:pagination?.hasPrev !== undefined ? !!pagination.hasPrev : offset > 0
  };
}
function normalizeOnlinePbxResponse(data, requestFilters={}){
  const calls=Array.isArray(data?.calls) ? data.calls.map(normalizeOnlinePbxCall) : [];
  const filters={...ONLINE_PBX_DEFAULT_FILTERS,...(data?.filters||{}),...(requestFilters||{})};
  return {
    ok:data?.ok === true,
    source:data?.source,
    filters,
    stats:computePbxStats(calls, data?.stats || {}),
    pagination:normalizeOnlinePbxPagination(data?.pagination, calls, filters),
    calls
  };
}
function onlinePbxBuildRequestBody(filters={}){
  const body={};
  const dateFrom=(filters.dateFrom||'').trim(),dateTo=(filters.dateTo||'').trim(),phone=(filters.phone||'').trim();
  const course=filters.course&&filters.course!=='all'?filters.course:'';
  const direction=filters.direction&&filters.direction!=='all'?filters.direction:'';
  const status=filters.status&&filters.status!=='all'?filters.status:'';
  const limit=Number.isFinite(Number(filters.limit))?Number(filters.limit):ONLINE_PBX_DEFAULT_FILTERS.limit;
  const offset=Number.isFinite(Number(filters.offset))?Number(filters.offset):0;
  const fetchLimit=Number.isFinite(Number(filters.fetchLimit))?Number(filters.fetchLimit):ONLINE_PBX_FETCH_LIMIT;
  if(dateFrom)body.dateFrom=dateFrom;
  if(dateTo)body.dateTo=dateTo;
  if(direction)body.direction=direction;
  if(status)body.status=status;
  if(phone)body.phone=phone;
  if(course)body.course=course;
  if(Object.keys(body).length || offset>0 || limit!==ONLINE_PBX_DEFAULT_FILTERS.limit){
    body.limit=limit;
    body.offset=offset;
    body.fetchLimit=Math.min(Math.max(fetchLimit, limit), ONLINE_PBX_FETCH_LIMIT);
  }
  return body;
}
async function fetchOnlinePbxCalls(filters={}){
  if(!ENABLE_ONLINEPBX){
    return normalizeOnlinePbxResponse({
      ok:true,
      source:'disabled',
      filters,
      stats:{},
      pagination:{limit:filters.limit||ONLINE_PBX_DEFAULT_FILTERS.limit,offset:filters.offset||0,returned:0,totalFiltered:0,hasNext:false,hasPrev:false},
      calls:[]
    }, filters);
  }
  const body=onlinePbxBuildRequestBody(filters);
  const { data, error } = await sb.functions.invoke(ONLINE_PBX_FUNCTION_NAME, { body });
  if(error)throw error;
  if(!data?.ok)throw new Error(data?.error || "OnlinePBX ma'lumotlarini olishda xatolik yuz berdi");
  return normalizeOnlinePbxResponse(data, filters);
}
async function fetchOnlinePbxAllCalls(filters={}){
  const allCalls=[];
  const baseFilters={...getPbxEffectiveChartFilters(filters),course:'all',limit:ONLINE_PBX_CHART_PAGE_LIMIT,offset:0,fetchLimit:ONLINE_PBX_FETCH_LIMIT};
  let offset=0;
  let lastData=null;

  for(let page=0;page<ONLINE_PBX_CHART_MAX_PAGES;page++){
    const pageFilters={...baseFilters,offset};
    const data=await fetchOnlinePbxCalls(pageFilters);
    lastData=data;
    const pageCalls=Array.isArray(data.calls) ? data.calls : [];
    allCalls.push(...pageCalls);
    const returned=onlinePbxNumber(data.pagination?.returned ?? pageCalls.length);
    const totalFiltered=Math.max(
      onlinePbxNumber(data.pagination?.totalFiltered),
      onlinePbxNumber(data.stats?.total),
      allCalls.length
    );
    const hasNext=data.pagination?.hasNext !== undefined
      ? (data.pagination.hasNext || allCalls.length<totalFiltered)
      : allCalls.length < totalFiltered;

    if(!returned || !hasNext || allCalls.length>=totalFiltered)break;
    offset+=returned;
  }

  return {
    calls:allCalls,
    filters:lastData?.filters || baseFilters,
    pagination:lastData?.pagination || null
  };
}
const onlinePbxService = {
  async fetchCalls(filters={}){
    return fetchOnlinePbxCalls(filters);
  }
};
function useOnlinePbxCalls(){return onlinePbxService;}
function setPbxPageLoading(loading){
  onlinePbxPageState.loading=loading;
  ['pbx_apply_btn','pbx_clear_btn'].forEach(id=>{const btn=document.getElementById(id);if(btn)btn.disabled=loading;});
  const apply=document.getElementById('pbx_apply_btn');if(apply)apply.classList.toggle('loading',loading);
}
function renderPbxResponsibles(){
  const grid=document.getElementById('pbx_responsibles_grid');
  if(!grid)return;
  const responsibilityMap=typeof buildCourseResponsibilityMap==='function'
    ? buildCourseResponsibilityMap(amoCrmActiveEmployees)
    : new Map();
  const courses=(typeof AMOCRM_DEPARTMENT_OPTIONS!=='undefined' ? AMOCRM_DEPARTMENT_OPTIONS : [])
    .filter(item=>['1-kurs','2-kurs','3-kurs','4-kurs','5-kurs','umumiy call'].includes(item.key));
  grid.innerHTML='';
  courses.forEach(course=>{
    const employees=(responsibilityMap.get(course.key)||[]).map(emp=>emp.name||emp.login).filter(Boolean);
    const fallback=(course.defaultNames||[]).filter(Boolean);
    const names=employees.length ? employees : fallback;
    const card=document.createElement('div');
    card.className='pbx-responsible-card';
    const chips=names.length
      ? names.map(name=>'<span>' + escapePbxHtml(name) + '</span>').join('')
      : '<em>' + escapePbxHtml(pbxText('unassignedResponsible')) + '</em>';
    card.innerHTML=[
      '<div class="pbx-responsible-course">' + pbxIcon('Headphones') + '<strong>' + escapePbxHtml(course.label) + '</strong></div>',
      '<div class="pbx-responsible-people">' + chips + '</div>'
    ].join('');
    grid.appendChild(card);
  });
  st('pbx_result_count', pbxText('courses') + ': ' + onlinePbxFormatNumber(courses.length));
}
function renderPbxStats(stats={}){
  ONLINE_PBX_PAGE_STAT_META.forEach(item=>st(item.el, onlinePbxFormatNumber(stats[item.id] || 0)));
}
function setPbxChartLoading(){
  const courseChart=document.getElementById('pbx_course_chart');
  const hourChart=document.getElementById('pbx_hour_chart');
  if(courseChart)courseChart.innerHTML='<div class="pbx-loading">' + pbxIcon('Loader2','spin') + ' ' + pbxText('chartLoading') + '</div>';
  if(hourChart)hourChart.innerHTML='<div class="pbx-loading">' + pbxIcon('Loader2','spin') + ' ' + pbxText('chartLoading') + '</div>';
  st('pbx_course_chart_note',pbxText('fullApiLoading'));
  st('pbx_hour_chart_note','-');
}
function getPbxCourseChartRows(calls=[]){
  const rows=new Map(Object.entries(PBX_COURSE_MAP).map(([code,label])=>[
    code,
    { code, label, total:0, incoming:0, outgoing:0, missed:0, answered:0, notCalledBack:0, notReached:0 }
  ]));

  (calls||[]).forEach(call=>{
    const info=getPbxCourseInfo(call);
    const row=rows.get(info.code);
    if(!row)return;
    const flags=getPbxCallStatFlags(call);
    row.total+=1;
    if(flags.incoming)row.incoming+=1;
    if(flags.outgoing)row.outgoing+=1;
    if(flags.missed)row.missed+=1;
    if(flags.answered)row.answered+=1;
    if(flags.notCalledBack)row.notCalledBack+=1;
    if(flags.notReached)row.notReached+=1;
  });

  return [...rows.values()];
}
function getPbxCourseMetricMeta(metric=pbxCourseChartMetric){
  return PBX_COURSE_CHART_METRICS.find(item=>item.id===metric) || PBX_COURSE_CHART_METRICS[0];
}
function renderPbxCourseMetricButtons(rows=[]){
  const wrap=document.getElementById('pbx_course_metric_buttons');
  if(!wrap)return;
  wrap.innerHTML='';
  PBX_COURSE_CHART_METRICS.forEach(item=>{
    const total=rows.reduce((sum,row)=>sum+onlinePbxNumber(row[item.id]),0);
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='pbx-chart-tab' + (item.id===pbxCourseChartMetric ? ' active' : '');
    btn.style.setProperty('--metric-color', item.color);
    btn.innerHTML=pbxIcon(item.icon) + '<span>' + escapePbxHtml(pbxMetricLabel(item)) + '</span><b>' + onlinePbxFormatNumber(total) + '</b>';
    btn.onclick=()=>setPbxCourseChartMetric(item.id);
    wrap.appendChild(btn);
  });
}
function setPbxCourseChartMetric(metric){
  if(!PBX_COURSE_CHART_METRICS.some(item=>item.id===metric))return;
  pbxCourseChartMetric=metric;
  renderPbxCourseChart(onlinePbxChartCalls);
}
function renderPbxCourseChartInto(calls=[], options={}){
  const chart=document.getElementById(options.chartId || 'pbx_course_chart');
  if(!chart)return;
  const rows=getPbxCourseChartRows(calls);
  const activeRows=rows.filter(row=>row.total>0);
  renderPbxCourseMetricButtons(rows, options.target || 'page');
  const metric=getPbxCourseMetricMeta();
  const max=Math.max(...rows.map(row=>onlinePbxNumber(row[metric.id])),1);
  const total=rows.reduce((sum,row)=>sum+row.total,0);
  const selectedTotal=rows.reduce((sum,row)=>sum+onlinePbxNumber(row[metric.id]),0);
  const note=metric.id==='total'
    ? onlinePbxFormatNumber(total) + ' ' + pbxText('callsCount')
    : pbxMetricLabel(metric) + ' ' + onlinePbxFormatNumber(selectedTotal) + ' / ' + pbxText('totalLabel') + ' ' + onlinePbxFormatNumber(total);
  st(options.noteId || 'pbx_course_chart_note', (options.rangeNote || getPbxRangeNote()) + ': ' + note);
  chart.innerHTML='';

  if(!activeRows.length){
    chart.innerHTML='<div class="pbx-empty">' + pbxText('noCourseCalls') + '</div>';
    return;
  }

  rows.forEach(row=>{
    const value=onlinePbxNumber(row[metric.id]);
    const height=Math.max(value ? 8 : 0, Math.round((value/max)*100));
    const bar=document.createElement('div');
    bar.className='pbx-course-bar' + (value===max && value>0 ? ' peak' : '') + (value ? '' : ' empty');
    bar.style.setProperty('--metric-color', metric.color);
    bar.innerHTML=[
      '<div class="pbx-course-count">' + (value ? onlinePbxFormatNumber(value) : '0') + '</div>',
      '<div class="pbx-course-track"><span style="height:' + height + '%"></span></div>',
      '<div class="pbx-course-name">' + escapePbxHtml(row.label) + '</div>'
    ].join('');
    bar.title=row.label + ': ' + pbxMetricLabel(metric) + ' ' + onlinePbxFormatNumber(value) + ', ' + pbxText('totalLabel') + ' ' + onlinePbxFormatNumber(row.total);
    chart.appendChild(bar);
  });
}
function renderPbxCourseChart(calls=[]){
  onlinePbxChartCalls=Array.isArray(calls) ? calls : [];
  renderPbxCourseChartInto(onlinePbxChartCalls,{target:'page',chartId:'pbx_course_chart',noteId:'pbx_course_chart_note',rangeNote:getPbxRangeNote()});
}
function formatPbxHourLabel(hour){
  return String(Number(hour || 0)).padStart(2,'0') + ':00';
}
function getPbxCallHour(value){
  if(!value)return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:TASHKENT_TIMEZONE,hour:'2-digit',hour12:false}).formatToParts(date);
  const hour=Number(parts.find(part=>part.type==='hour')?.value);
  return Number.isFinite(hour) ? hour % 24 : null;
}
function renderPbxHourChart(calls=[]){
  const chart=document.getElementById('pbx_hour_chart');
  if(!chart)return;
  const rows=Array.from({length:24},(_,hour)=>({hour,total:0,talked:0}));
  (calls||[]).forEach(call=>{
    const hour=getPbxCallHour(call.date);
    if(hour===null)return;
    rows[hour].total+=1;
    if(onlinePbxNumber(call.duration)>0)rows[hour].talked+=1;
  });
  const total=rows.reduce((sum,row)=>sum+row.total,0);
  const peak=rows.reduce((best,row)=>row.total>best.total?row:best,rows[0]);
  const max=Math.max(...rows.map(row=>row.total),1);
  st('pbx_hour_chart_note', total ? pbxText('most') + ': ' + formatPbxHourLabel(peak.hour) + ' (' + onlinePbxFormatNumber(peak.total) + ')' : '-');
  chart.innerHTML='';

  if(!total){
    chart.innerHTML='<div class="pbx-empty">' + pbxText('noHourCalls') + '</div>';
    return;
  }

  rows.forEach(row=>{
    const bar=document.createElement('div');
    bar.className='pbx-hour-bar' + (row.hour===peak.hour ? ' peak' : '');
    const height=Math.max(row.total ? 8 : 0, Math.round((row.total/max)*100));
    bar.innerHTML=[
      '<div class="pbx-hour-count">' + (row.total ? onlinePbxFormatNumber(row.total) : '') + '</div>',
      '<div class="pbx-hour-track"><span style="height:' + height + '%"></span></div>',
      '<div class="pbx-hour-label">' + formatPbxHourLabel(row.hour) + '</div>'
    ].join('');
    bar.title=formatPbxHourLabel(row.hour) + ' - ' + onlinePbxFormatNumber(row.total) + ' ' + pbxText('callsCount') + ', ' + onlinePbxFormatNumber(row.talked) + ' ' + pbxText('answered').toLowerCase();
    chart.appendChild(bar);
  });
}
function renderPbxCharts(calls=[]){
  onlinePbxChartCalls=Array.isArray(calls) ? calls : [];
  renderPbxCourseChart(calls);
  renderPbxHourChart(calls);
}
function renderPbxStateMessage(type,text){
  const el=document.getElementById('pbx_status_message');if(!el)return;
  el.className=('pbx-state-message ' + (type||'')).trim();
  el.classList.toggle('hidden',!text);
  el.innerHTML=text?(type==='error'?pbxIcon('AlertCircle'):type==='loading'?pbxIcon('Loader2','spin'):pbxIcon('PhoneCall')) + '<span>' + text + '</span>':'';
}
function setPbxResponsiblesLoading(){
  const grid=document.getElementById('pbx_responsibles_grid');
  if(grid)grid.innerHTML='<div class="pbx-loading">' + pbxIcon('Loader2','spin') + ' ' + pbxText('loading') + '</div>';
  setPbxChartLoading();
  st('pbx_result_count','-');
}
function renderPbxPage(data,{chartsLoading=false}={}){
  const filters={...ONLINE_PBX_DEFAULT_FILTERS,...(onlinePbxPageState.filters||{}),...(data.filters||{})};
  const course=filters.course || 'all';
  const calls=filterCallsByCourse(data.calls || [], course);
  const stats=course && course!=='all' ? computePbxStats(calls, {}) : computePbxStats(calls, data.stats || {});
  const pagination=course && course!=='all'
    ? normalizeOnlinePbxPagination(null, calls, {...filters,totalFiltered:calls.length})
    : normalizeOnlinePbxPagination(data.pagination, calls, filters);
  onlinePbxPageState.pagination=pagination;
  renderPbxStats(stats);
  if(chartsLoading)setPbxChartLoading();
  else renderPbxCharts(calls);
  renderPbxResponsibles();
  const loaded=document.getElementById('pbx_loaded_at');if(loaded)loaded.textContent=pbxText('updated') + ': ' + formatOnlinePbxDate(new Date().toISOString());
  renderPbxStateMessage('', '');
}
async function loadPbxStats(options={}){
  const filters=options.filters||readOnlinePbxFilters();
  const requestId=++onlinePbxPageState.requestId;
  onlinePbxPageState.filters={...ONLINE_PBX_DEFAULT_FILTERS,...filters};onlinePbxPageState.error=null;
  setOnlinePbxFilterInputs(onlinePbxPageState.filters);
  refreshPbxStaticLabels();
  setPbxPageLoading(true);setPbxResponsiblesLoading();renderPbxStateMessage('loading',pbxText('loading'));
  try{
    const data=await useOnlinePbxCalls().fetchCalls(onlinePbxPageState.filters);
    if(requestId!==onlinePbxPageState.requestId)return;
    onlinePbxPageState.data=data;onlinePbxPageState.lastLoadedAt=new Date();renderPbxPage(data,{chartsLoading:true});
    try{
      const fullData=await fetchOnlinePbxAllCalls(onlinePbxPageState.filters);
      if(requestId!==onlinePbxPageState.requestId)return;
      const course=onlinePbxPageState.filters.course || 'all';
      const fullCalls=filterCallsByCourse(fullData.calls || [], course);
      renderPbxCharts(fullCalls);
      renderPbxStats(computePbxStats(fullCalls, {}));
    }catch(chartErr){
      if(requestId!==onlinePbxPageState.requestId)return;
      console.error('loadPbxCharts error:',chartErr);
      renderPbxCharts(data.calls || []);
    }
  }catch(err){
    if(requestId!==onlinePbxPageState.requestId)return;
    console.error('loadPbxStats error:',err);
    onlinePbxPageState.error=err;
    onlinePbxPageState.pagination=null;
    renderPbxStats(computePbxStats([]));
    renderPbxCharts([]);
    renderPbxResponsibles();
    renderPbxStateMessage('error',pbxText('error'));
  }finally{if(requestId===onlinePbxPageState.requestId)setPbxPageLoading(false);}
}
function applyPbxFilters(){setPbxCalendarOpen(false);loadPbxStats({filters:{...readOnlinePbxFilters(),offset:0}});}
function clearPbxFilters(){const filters={...ONLINE_PBX_DEFAULT_FILTERS};setOnlinePbxFilterInputs(filters);setPbxCalendarOpen(false);loadPbxStats({filters});}
document.addEventListener('keydown', event=>{if(event.key==='Escape')setPbxCalendarOpen(false);});
document.addEventListener('keydown', event=>{
  if(event.key==='Enter' && event.target && event.target.id==='pbx_phone')applyPbxFilters();
});
setOnlinePbxFilterInputs(ONLINE_PBX_DEFAULT_FILTERS);
refreshPbxStaticLabels();
async function refreshAmoCrmTasks(showLoading=true){
  await loadAmoCrmDepartmentCounts({showLoading});
}
function subscribeAmoCrmTaskRealtime(){
  if(!CU || CU.role!=='admin')return;
  amoCrmTaskRealtime = removeRealtimeChannel(amoCrmTaskRealtime);
  amoCrmTaskRealtime = sb
    .channel('amocrm-active-tasks-changes')
    .on('postgres_changes',{
      event:'*',
      schema:REALTIME_SCHEMA,
      table:'amocrm_active_tasks'
    }, async () => {
      if(currentAdminTab==='amocrm')await loadAmoCrmDepartmentCounts({showLoading:true});
    })
    .subscribe();
}
function startAmoCrmRefreshInterval(){
  if(amoCrmRefreshTimer)clearInterval(amoCrmRefreshTimer);
  amoCrmRefreshTimer=setInterval(()=>{
    if(currentAdminTab==='amocrm')loadAmoCrmDepartmentCounts({showLoading:true});
  }, 30000);
}
function startAmoCrmTaskPage(){
  refreshAmoCrmStaticLabels();
  subscribeAmoCrmTaskRealtime();
  startAmoCrmRefreshInterval();
  loadAmoCrmDepartmentCounts({showLoading:true});
}
function stopAmoCrmTaskPage(){
  amoCrmTaskRealtime = removeRealtimeChannel(amoCrmTaskRealtime);
  if(amoCrmRefreshTimer){
    clearInterval(amoCrmRefreshTimer);
    amoCrmRefreshTimer=null;
  }
}
function setAttendanceTableMode(monthly){
  const dateRange=document.getElementById('att_date_range');
  const todayBtn=document.getElementById('b_today');
  const statusFilter=document.getElementById('fstatus');
  if(dateRange)dateRange.style.display=monthly?'none':'flex';
  if(todayBtn)todayBtn.style.display=monthly?'none':'';
  if(statusFilter)statusFilter.style.display=monthly?'none':'';
  ['th7','th_afk'].forEach(id=>{
    const th=document.getElementById(id);
    if(th)th.style.display=monthly?'none':'';
  });

  if(monthly){
    st('att_t', t('monthly_att_summary_title'));
    st('th1', t('mas_emp'));
    st('th2', t('th2'));
    st('th4', t('mas_month'));
    st('th5', t('mas_worked_days'));
    st('th_lunch_start', t('mas_late_count'));
    st('th_lunch_end', t('mas_absent_days'));
    st('th_break', t('mas_break_time'));
    st('th_end', t('mas_late_time'));
    st('th8', t('mas_actions'));
  }else{
    st('att_t', t('att_t'));
    st('th1', t('th1'));
    st('th2', t('th2'));
    st('th4', t('th4'));
    st('th5', t('th5'));
    st('th_lunch_start', t('mt_lunch_start'));
    st('th_lunch_end', t('mt_lunch_end'));
    st('th_break', t('extra_break'));
    st('th_end', t('mt_end'));
    st('th7', t('th7'));
    st('th_afk', t('th_afk'));
    st('th8', t('th8'));
  }
}
function toggleMonthly(){
  mVisible=!mVisible;
  document.getElementById('mbox').classList.toggle('hidden',!mVisible);
  if(mVisible)loadMonthly();
  else loadAtt();
}
async function loadTodayWorkLeaveCard(){
  const today=todayISO();
  const [leaves, emps] = await Promise.all([
    fetchEmployeeLeavesInRange(today,today),
    sb.from('employees').select('id,name').eq('active',true)
  ]);
  const empMap=new Map(((emps.data)||[]).map(emp=>[emp.id, emp.name||'-']));
  latestTodayLeaveRows=(leaves||[]).map((leave,index)=>({
    ...leave,
    employee_name: empMap.get(leave.employee_id) || '-',
    status: t('on_work_leave')
  }));
  st('sleave', String(latestTodayLeaveRows.length));
}
async function openWorkLeaveModal(){
  const today=todayISO();
  st('work_leave_title', t('employees_on_work_leave'));
  st('work_leave_subtitle', fmtD(new Date(`${today}T12:00:00`)));
  const tbody=document.getElementById('work_leave_body');
  if(!tbody)return;
  let rows=[];
  if(employeeLeavesTableAvailable){
    const [leaveRes, empRes] = await Promise.all([
      sb.from('employee_leaves').select('id,employee_id,leave_start_date,return_date,created_at').lte('leave_start_date', today).order('leave_start_date', {ascending:false}),
      sb.from('employees').select('id,name')
    ]);
    if(!leaveRes.error){
      const empMap=new Map(((empRes.data)||[]).map(emp=>[emp.id, emp.name||'-']));
      rows=(leaveRes.data||[]).filter(row=>normalizeIsoDate(row.leave_start_date)&&normalizeIsoDate(row.return_date)).map(row=>({
        ...row,
        employee_name: empMap.get(row.employee_id) || '-',
        status: today<=row.return_date ? t('on_work_leave') : t('returned')
      }));
    }else if(/employee_leaves|relation/i.test(leaveRes.error.message||'')){
      employeeLeavesTableAvailable=false;
    }
  }
  if(!rows.length && latestTodayLeaveRows.length)rows=latestTodayLeaveRows;
  tbody.innerHTML='';
  if(!rows.length){
    tbody.innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:18px">${t('no_employees_on_work_leave')}</td></tr>`;
    document.getElementById('m_work_leave').classList.remove('hidden');
    return;
  }
  rows.forEach((row,i)=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${i+1}</td><td>${row.employee_name||'-'}</td><td style="font-family:var(--mono)">${row.leave_start_date}</td><td style="font-family:var(--mono)">${row.return_date}</td><td><span class="badge bauto">${row.status}</span></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('m_work_leave').classList.remove('hidden');
}
function closeWorkLeaveModal(){document.getElementById('m_work_leave').classList.add('hidden');}

function fmtDashHours(sec){
  sec=Math.max(0,sec||0);
  return Math.floor(sec/3600)+'h '+Math.floor((sec%3600)/60)+'m';
}
function renderDashList(id,items,valueFn){
  const el=document.getElementById(id);if(!el)return;
  if(!items||items.length===0){el.innerHTML=`<div class="dash-empty">${t('no_data')}</div>`;return;}
  el.innerHTML=items.slice(0,5).map((item,i)=>`
    <div class="dash-row">
      <div class="dash-name">${i+1}. ${item.name}</div>
      <div class="dash-val">${valueFn(item)}</div>
    </div>
  `).join('');
}
function renderDashboardCharts(rows,workDays,empCount,recs=[]){
  const overall=document.getElementById('dashOverall');
  const stats=document.getElementById('dash_work_stats');
  const chart=document.getElementById('dash_work_chart');
  const labels=document.getElementById('dash_work_labels');
  const bars=document.getElementById('dash_late');
  const foot=document.getElementById('dash_kpi');
  const totalSlots=Math.max(0,workDays*empCount);
  const present=rows.reduce((s,x)=>s+(x.came||0),0);
  const overallPct=totalSlots?Math.round((present/totalSlots)*100):0;
  if(overall)overall.textContent=overallPct+'%';

  const today=new Date(todayISO()+'T12:00:00');
  const last7=[];
  for(let i=6;i>=0;i--){
    const d=new Date(today);
    d.setDate(d.getDate()-i);
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dayRecs=(recs||[]).filter(r=>r.work_date===ds);
    const presentCount=dayRecs.filter(r=>!!r.start_time).length;
    const lateCount=dayRecs.filter(r=>(r.late_minutes||0)>0).length;
    const absentCount=Math.max(0, empCount-presentCount);
    const pct=empCount?Math.round((presentCount/empCount)*100):0;
    last7.push({
      key:ds,
      label:`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`,
      short:['Yak','Dush','Sesh','Chor','Pay','Jum','Shan'][d.getDay()],
      pct,
      present:presentCount,
      late:lateCount,
      absent:absentCount
    });
  }

  const avg7=last7.length?Math.round(last7.reduce((s,x)=>s+x.pct,0)/last7.length):0;
  const bestDay=last7.reduce((best,item)=>item.pct>best.pct?item:best,last7[0]||{pct:0,label:'-'});
  if(stats){
    stats.innerHTML = [
      { value:`${avg7}%`, label:t('dash_avg7') },
      { value:`${bestDay?.pct||0}%`, label:`${t('dash_best_day')}: ${bestDay?.label||'-'}` }
    ].map(item=>`<div class="dash-mini-stat"><strong>${item.value}</strong><span>${item.label}</span></div>`).join('');
  }
  if(labels){
    labels.innerHTML = last7.map(item=>`<span title="${item.label}">${item.short}</span>`).join('');
  }
  if(chart){
    if(!last7.length){
      chart.innerHTML='';
    }else{
      const width=640, height=190, padX=24, padTop=18, padBottom=34;
      const usableW=width-padX*2;
      const usableH=height-padTop-padBottom;
      const step=last7.length>1?usableW/(last7.length-1):usableW;
      const points=last7.map((item,idx)=>{
        const x=padX + step*idx;
        const y=padTop + (usableH - (item.pct/100)*usableH);
        return {x,y,...item};
      });
      const line=points.map(p=>`${p.x},${p.y}`).join(' ');
      const area=`${padX},${height-padBottom} ${line} ${padX+usableW},${height-padBottom}`;
      const dots=points.map((p,idx)=>`<circle class="dash-line-dot${idx===points.length-1?' active':''}" cx="${p.x}" cy="${p.y}" r="${idx===points.length-1?5:4}"><title>${p.label}: ${p.pct}%</title></circle>`).join('');
      chart.innerHTML = `
        <defs>
          <linearGradient id="dashLineGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(11,78,162,.26)"></stop>
            <stop offset="100%" stop-color="rgba(11,78,162,0)"></stop>
          </linearGradient>
        </defs>
        <polyline class="dash-line-area" points="${area}"></polyline>
        <polyline class="dash-line-path" points="${line}"></polyline>
        ${dots}
      `;
    }
  }

  const sortedRows=rows.slice().sort((a,b)=>b.efficiency-a.efficiency);
  if(bars){
    if(sortedRows.length===0){
      bars.innerHTML=`<div class="dash-empty">${t('no_data')}</div>`;
    }else{
      bars.innerHTML=sortedRows.map(x=>`
        <div class="dash-eff-card" title="${x.name}: ${x.efficiency}%">
          <div class="dash-eff-head">
            <div class="dash-eff-name">${x.name}</div>
            <div class="dash-eff-score-wrap">
              <span class="dash-eff-score-label">${t('eff_title')}</span>
              <span class="dash-eff-score">${x.efficiency}%</span>
            </div>
          </div>
          <div class="dash-eff-breakdown">
            <div class="dash-eff-row">
              <div class="dash-eff-label"><span class="dash-eff-dot green"></span><span>${t('eff_work_hours')}</span></div>
              <div class="dash-eff-value">${x.workPct}%</div>
            </div>
            <div class="dash-eff-row">
              <div class="dash-eff-label"><span class="dash-eff-dot red"></span><span>${t('eff_late')}</span></div>
              <div class="dash-eff-value">-${x.latePenalty}%</div>
            </div>
            <div class="dash-eff-row">
              <div class="dash-eff-label"><span class="dash-eff-dot red"></span><span>${t('eff_afk')}</span></div>
              <div class="dash-eff-value">-${x.afkPenalty}%</div>
            </div>
          </div>
        </div>
      `).join('');
    }
  }
  if(foot){
    const best=sortedRows[0];
    foot.textContent=best?`${t('dash_efficiency_best')}: ${best.name} (${best.efficiency}%)`:'';
    foot.title=t('dash_efficiency_hint');
  }
  if(currentAdminTab==='main')animateVisibleCards(document.getElementById('tab_main'));
}
let amoCrmActiveEmployees = [];
let unfinishedTaskWarningAt = 0;
const AMOCRM_EMPLOYEE_COURSE_COLUMN = 'responsible_course';
const AMOCRM_DEPARTMENT_OPTIONS = [
  {key:'1-kurs', label:'1-kurs', ids:[8952522], defaultNames:['Abdullayeva Sabina']},
  {key:'2-kurs', label:'2-kurs', ids:[8952902], defaultNames:['Rustamova Sevinch']},
  {key:'3-kurs', label:'3-kurs', ids:[8952890], defaultNames:['Mamarajabova Mohinur']},
  {key:'4-kurs', label:'4-kurs', ids:[8952886], defaultNames:['Djumanazarova Sabina']},
  {key:'5-kurs', label:'5-kurs', ids:[8952862], defaultNames:['Ergashboyeva Donoxon','Musulmonova Vazira']},
  {key:'umumiy call', label:'Umumiy call', ids:[], defaultNames:["Zokirova Ra'no"]},
  {key:'copywriter', label:'Copywriter', ids:[9035378], defaultNames:['Umirbekov Diyorbek']}
];
function normalizeAmoCrmDepartmentName(name=''){
  return String(name).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
}
function getAmoCrmResponsibleShortName(row){
  const byName={
    '1-kurs':'Abdullayeva S.',
    '2-kurs':'Rustamova S.',
    '3-kurs':'Mamarajabova M.',
    '4-kurs':'Djumanazarova S.',
    '5-kurs':'Musulmonova V., Ergashboyeva D.',
    'umumiy call':'Zokirova R.',
    'copywriter':'Umirbekov D.'
  };
  const byId={
    8952522:'Abdullayeva S.',
    8952902:'Rustamova S.',
    8952890:'Mamarajabova M.',
    8952886:'Djumanazarova S.',
    8952862:'Musulmonova V., Ergashboyeva D.',
    9035378:'Umirbekov D.'
  };
  const id=Number(row?.responsible_user_id);
  return byName[normalizeAmoCrmDepartmentName(row?.department_name)] || byId[id] || '';
}
function normalizeEmployeeName(name=''){
  return String(name).toLowerCase().replace(/[`´‘’]/g,"'").replace(/\s+/g,' ').trim();
}
function shortEmployeeName(name=''){
  const parts=String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length)return '';
  if(parts.length===1)return parts[0];
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}
function normalizeCourseKey(value=''){
  const text=normalizeAmoCrmDepartmentName(value);
  if(!text)return '';
  if(text.includes('1-kurs') || text.includes('1 kurs'))return '1-kurs';
  if(text.includes('2-kurs') || text.includes('2 kurs'))return '2-kurs';
  if(text.includes('3-kurs') || text.includes('3 kurs'))return '3-kurs';
  if(text.includes('4-kurs') || text.includes('4 kurs'))return '4-kurs';
  if(text.includes('5-kurs') || text.includes('5 kurs'))return '5-kurs';
  if(text.includes('umumiy') && text.includes('call'))return 'umumiy call';
  if(text.includes('copywriter'))return 'copywriter';
  const opt=AMOCRM_DEPARTMENT_OPTIONS.find(item=>normalizeAmoCrmDepartmentName(item.key)===text || normalizeAmoCrmDepartmentName(item.label)===text);
  return opt?.key || text;
}
function getAmoCrmDepartmentKey(row){
  const id=Number(row?.responsible_user_id);
  const byId={};
  AMOCRM_DEPARTMENT_OPTIONS.forEach(opt=>(opt.ids||[]).forEach(optId=>{byId[optId]=opt.key;}));
  return byId[id] || normalizeCourseKey(row?.department_name);
}
function getCourseLabel(key){
  const normalized=normalizeCourseKey(key);
  const opt=AMOCRM_DEPARTMENT_OPTIONS.find(item=>item.key===normalized);
  return opt?.label || normalized || t('course_none');
}
function setAmoCrmActiveEmployees(employees=[]){
  amoCrmActiveEmployees=(employees||[]).filter(emp=>emp && emp.id);
}
function getDefaultCourseForEmployee(emp){
  const name=normalizeEmployeeName(emp?.name || '');
  if(!name)return '';
  const match=AMOCRM_DEPARTMENT_OPTIONS.find(opt=>(opt.defaultNames||[]).some(defaultName=>normalizeEmployeeName(defaultName)===name));
  return match?.key || '';
}
function getEmployeeCourseResponsibilityKey(emp){
  if(!emp?.id)return '';
  return normalizeCourseKey(emp?.responsible_course || '') || getDefaultCourseForEmployee(emp);
}
function showUnfinishedTaskWarning({force=false}={}){
  const now=Date.now();
  if(!force && now-unfinishedTaskWarningAt<AUTO_END_TASK_WARNING_INTERVAL_MS)return;
  unfinishedTaskWarningAt=now;
  toast('warn', t('be'), t('unfinished_tasks_warning'), 6500);
}
async function employeeHasUnfinishedAmoCrmTasks(emp=CU){
  const courseKey=getEmployeeCourseResponsibilityKey(emp);
  if(!courseKey)return false;
  const {data,error}=await fetchAmoCrmDepartmentTaskCounts();
  if(error)throw error;
  return (data||[]).some(row=>getAmoCrmDepartmentKey(row)===courseKey && amoCrmSafeCount(row.active_tasks)>0);
}
async function canFinishWorkByAmoCrmTasks({auto=false}={}){
  if(!CU || CU.role!=='employee')return true;
  const hasTasks=await employeeHasUnfinishedAmoCrmTasks(CU);
  if(!hasTasks)return true;
  showUnfinishedTaskWarning({force:!auto});
  return false;
}
async function updateEmployeeCourseResponsibility(employeeId, courseKey){
  if(!employeeId)return;
  const normalized=normalizeCourseKey(courseKey);
  const { error } = await sb
    .from('employees')
    .update({ [AMOCRM_EMPLOYEE_COURSE_COLUMN]: normalized || null })
    .eq('id', employeeId);
  if(error)throw error;
}
function buildCourseResponsibilityMap(employees=amoCrmActiveEmployees){
  const map=new Map(AMOCRM_DEPARTMENT_OPTIONS.map(opt=>[opt.key,[]]));
  const seen=new Map(AMOCRM_DEPARTMENT_OPTIONS.map(opt=>[opt.key,new Set()]));
  const add=(key,emp)=>{
    const normalized=normalizeCourseKey(key);
    if(!normalized || !emp)return;
    if(!map.has(normalized)){
      map.set(normalized,[]);
      seen.set(normalized,new Set());
    }
    const marker=String(emp.id || normalizeEmployeeName(emp.name));
    if(seen.get(normalized).has(marker))return;
    seen.get(normalized).add(marker);
    map.get(normalized).push(emp);
  };
  (employees||[]).forEach(emp=>{
    const key=getEmployeeCourseResponsibilityKey(emp);
    if(key)add(key,emp);
  });
  AMOCRM_DEPARTMENT_OPTIONS.forEach(opt=>{
    const order=new Map((opt.defaultNames||[]).map((name,idx)=>[normalizeEmployeeName(name),idx]));
    const arr=map.get(opt.key);
    if(arr){
      arr.sort((a,b)=>{
        const ai=order.has(normalizeEmployeeName(a.name)) ? order.get(normalizeEmployeeName(a.name)) : 999;
        const bi=order.has(normalizeEmployeeName(b.name)) ? order.get(normalizeEmployeeName(b.name)) : 999;
        if(ai!==bi)return ai-bi;
        return String(a.name||a.login||'').localeCompare(String(b.name||b.login||''), 'uz');
      });
    }
  });
  return map;
}
function getAmoCrmResponsibleShortNames(row, employees=amoCrmActiveEmployees, responsibilityMap=null){
  const courseKey=getAmoCrmDepartmentKey(row);
  const map=responsibilityMap || buildCourseResponsibilityMap(employees);
  return (map.get(courseKey)||[]).map(emp=>shortEmployeeName(emp.name||emp.login)).filter(Boolean);
}
function getAmoCrmResponsibleShortName(row, employees=amoCrmActiveEmployees){
  return getAmoCrmResponsibleShortNames(row, employees).join(', ');
}
async function loadDashboard(){
  const month=document.getElementById('fmonth')?.value||curM();
  st('dash_month',month);
  const chart=document.getElementById('dash_work_chart');
  const stats=document.getElementById('dash_work_stats');
  const labels=document.getElementById('dash_work_labels');
  if(chart)chart.innerHTML='';
  if(stats)stats.innerHTML=`<div class="dash-mini-stat"><strong>...</strong><span>${t('loading')}</span></div>`;
  if(labels)labels.innerHTML='';
  ['dash_late','dash_kpi'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=`<div class="dash-empty">${t('loading')}</div>`;});
  const[y,mo]=month.split('-').map(Number);const dim=new Date(y,mo,0).getDate();
  let wd=0;for(let d=1;d<=dim;d++){const ds=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if(isWorkDay(ds))wd++;}
  const monthStart=`${month}-01`;
  const monthEnd=`${month}-${String(dim).padStart(2,'0')}`;
  const [{data:emps,error:empErr},{data:recs,error:recErr},leaves] = await Promise.all([
    sb.from('employees').select('*'),
    sb.from('attendance').select('*').gte('work_date',monthStart).lte('work_date',monthEnd),
    fetchEmployeeLeavesInRange(monthStart, monthEnd)
  ]);
  if(empErr||recErr){toast('error','Dashboard',(empErr||recErr).message||t('dashboard_error'));return;}
  const leaveDateMap=buildEmployeeLeaveDateMap(leaves, monthStart, monthEnd);
  const rows=(emps||[]).map(emp=>{
    const er=(recs||[]).filter(r=>r.employee_id===emp.id);
    let sec=0,afkSec=0,late=0,lateMin=0,came=0,half=0;
    const cameDates=new Set();
    er.forEach(r=>{
      if(r.start_time){
        came++;
        if(r.work_date)cameDates.add(r.work_date);
        const[h,m]=r.start_time.split(':').map(Number);if(h*60+m>LATE_AFTER_MINUTES)late++;
      }
      if(computeStatusByTimes(
        r.start_time?r.start_time.substring(0,5):null,
        r.end_time?r.end_time.substring(0,5):null,
        r.late_minutes||0,
        r.work_seconds||0
      )==='yarim_kun')half++;
      sec+=r.work_seconds||0;
      afkSec+=r.afk_seconds||0;
      lateMin+=r.late_minutes||0;
    });
    const leaveDates=leaveDateMap.get(emp.id)||new Set();
    const abs=countAbsencesForMonth(month,cameDates,leaveDates);
    const expectedSec=Math.max(1,wd*TARGET_WORK_SEC_PER_DAY);
    const workPct=Math.min(100,Math.round((sec/expectedSec)*100));
    const latePenalty=Math.min(20,(late*5)+Math.floor((lateMin||0)/60));
    const afkPenalty=Math.min(15,Math.round(Math.max(0,afkSec)/(5*60)));
    const efficiency=Math.max(0,Math.min(100,Math.round(workPct-latePenalty-afkPenalty)));
    return {name:emp.name||'-',sec,late,lateMin,came,abs,efficiency,workPct,latePenalty,afkPenalty};
  });
  renderDashboardCharts(rows,wd,(emps||[]).length,recs||[]);
}

async function loadAtt() {
  if (mVisible) {
    setAttendanceTableMode(true);
    await loadMonthly();
    return;
  }
  setAttendanceTableMode(false);
  const dateFrom = document.getElementById('fd_from').value || todayISO();
  const dateTo = document.getElementById('fd_to').value || todayISO();
  const search = document.getElementById('fsearch').value || '';
  const statusFilter = document.getElementById('fstatus').value || '';

  const [{ data, error }, leaves] = await Promise.all([
    sb.rpc('admin_attendance_range', {
      p_from: dateFrom,
      p_to: dateTo,
      p_search: search,
      p_status: statusFilter
    }),
    fetchEmployeeLeavesInRange(dateFrom, dateTo)
  ]);

  if (error) {
    console.error('loadAtt rpc error:', error);
    toast('error', t('error_title'), error.message || t('attendance_load_error'));
    return;
  }

  const tbody = document.getElementById('att_body');
  tbody.innerHTML = '';

  let w = 0, l = 0, a = 0;
  const leaveDateMap=buildEmployeeLeaveDateMap(leaves, dateFrom, dateTo);

  if (dateFrom === dateTo) {
    (data || []).forEach((row, i) => {
      let status = row.status || 'kelmadi';
      if(isEmployeeOnLeaveDate(row.employee_id, dateFrom, leaveDateMap))status='work_leave';
      let arr = row.start_time ? row.start_time.substring(0, 5) : '-';
      let lunchStart = row.lunch_start ? row.lunch_start.substring(0, 5) : '-';
      let lunchEnd = row.lunch_end ? row.lunch_end.substring(0, 5) : '-';
      let endTime = row.end_time ? row.end_time.substring(0, 5) : '-';
      let hrs = row.worked_seconds ? secToHMS(row.worked_seconds) : '-';
      let breakSec = row.extra_break_seconds || 0;
      let breakFmt = breakSec > 0 ? secToHMS(breakSec) : '-';
      let afkSec = row.afk_seconds || 0;

      if (status === 'keldi' || status === 'auto_ended' || status === 'yarim_kun') w++;
      else if (status === 'kechikkan') l++;
      else if (status === 'kelmadi') a++;

      let bc2 = 'bgr', bt = t('b_off');
      if (status === 'keldi') {
        bc2 = 'bg';
        bt = t('b_came');
      } else if (status === 'kechikkan') {
        bc2 = 'by';
        bt = t('b_late');
      } else if (status === 'kelmadi') {
        bc2 = 'br';
        bt = t('b_abs');
      } else if (status === 'yarim_kun') {
        bc2 = 'bauto';
        bt = t('b_half');
      } else if (status === 'auto_ended') {
        bc2 = 'bg';
        bt = `⚙️ ${t('auto_label')}`;
      } else if (status === 'work_leave') {
        bc2 = 'bauto';
        bt = t('on_work_leave');
      }

      const afkFmt = formatPenaltyAfk(afkSec);

      const tr = document.createElement('tr');
      tr.dataset.name = (row.employee_name || '').toLowerCase();
      tr.dataset.st = status;

      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${row.employee_name || '-'}</td>
        <td style="font-family:var(--mono)">${row.employee_login || '-'}</td>
        <td><button class="bsm bsm-g" onclick="openEP('${row.employee_id}')">${t('change')}</button></td>
        <td style="font-family:var(--mono)">${arr}</td>
        <td style="font-family:var(--mono)">${lunchStart}</td>
        <td style="font-family:var(--mono)">${lunchEnd}</td>
        <td style="font-family:var(--mono)">${breakFmt}</td>
        <td style="font-family:var(--mono)">${endTime}</td>
        <td style="font-family:var(--mono)">${hrs}</td>
        <td style="color:${afkSec > 0 ? 'var(--danger)' : 'var(--text2)'};">${afkFmt}</td>
        <td><span class="badge ${bc2}">${bt}</span></td>
      `;

      tbody.appendChild(tr);
    });
  } else {
    const grouped = {};

    (data || []).forEach((row) => {
      const id = row.employee_id;
      if (!grouped[id]) {
        grouped[id] = {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          employee_login: row.employee_login,
          totalSec: 0,
          totalAfk: 0,
          totalBreak: 0,
          totalLate: 0,
          dayCount: 0
        };
      }

      grouped[id].totalSec += row.worked_seconds || 0;
      grouped[id].totalAfk += row.afk_seconds || 0;
      grouped[id].totalBreak += row.extra_break_seconds || 0;
      grouped[id].totalLate += row.late_minutes || 0;

      if (row.work_date) grouped[id].dayCount++;
    });

    Object.values(grouped).forEach((emp, i) => {
      const hrs2 = emp.totalSec > 0
        ? Math.floor(emp.totalSec / 3600) + 'h ' + Math.floor((emp.totalSec % 3600) / 60) + 'm'
        : '—';

      const afkFmt2 = formatPenaltyAfk(emp.totalAfk);
      const breakFmt2 = emp.totalBreak > 0 ? secToHMS(emp.totalBreak) : '-';

      const tr = document.createElement('tr');
      tr.dataset.name = (emp.employee_name || '').toLowerCase();
      tr.dataset.st = 'keldi';

      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${emp.employee_name || '-'}</td>
        <td>${emp.employee_login || '-'}</td>
        <td><button class="bsm bsm-g" onclick="openEP('${emp.employee_id}')">${t('change')}</button></td>
        <td>${emp.dayCount} ${t('kun')}</td>
        <td>-</td>
        <td>-</td>
        <td style="font-family:var(--mono)">${breakFmt2}</td>
        <td>-</td>
        <td>${hrs2}</td>
        <td style="color:${emp.totalAfk > 0 ? 'var(--danger)' : 'var(--text2)'}">${afkFmt2}</td>
        <td><span class="badge bg">${emp.dayCount} ${t('kun')}</span></td>
      `;

      tbody.appendChild(tr);
    });
  }

  st('sw', '' + w);
  st('sl', '' + l);
  st('sa', '' + a);
  st('sd', dateFrom === dateTo ? fmtD(new Date(dateFrom + 'T12:00:00')) : dateFrom + ' → ' + dateTo);
}
function filterAtt(){
  const q=document.getElementById('fsearch').value.toLowerCase();
  const s=document.getElementById('fstatus').value;
  document.querySelectorAll('#att_body tr').forEach(tr=>{
    const matchesName=(tr.dataset.name||'').includes(q);
    const matchesStatus=mVisible?true:(!s||tr.dataset.st===s);
    tr.style.display=(matchesName&&matchesStatus)?'':'none';
  });
  document.querySelectorAll('#mbody tr').forEach(tr=>{
    tr.style.display=((tr.dataset.name||'').includes(q))?'':'none';
  });
}

function syncMonthlyEmployeeFilter(emps=[]){
  const sel=document.getElementById('monthly_employee_filter');
  if(!sel)return 'all';
  const previous=sel.value||'all';
  sel.innerHTML=`<option value="all">${t('monthly_employee_all')}</option>`+(emps||[]).map(emp=>`<option value="${emp.id}">${emp.name||emp.login||'-'}</option>`).join('');
  sel.value=(previous!=='all'&&(emps||[]).some(emp=>emp.id===previous))?previous:'all';
  return sel.value||'all';
}

async function loadMonthly(){
  if(mVisible)setAttendanceTableMode(true);
  const month=document.getElementById('fmonth').value||curM();
  st('mlbl',month+' '+t('hisobot'));
  const[y,mo]=month.split('-').map(Number);const dim=new Date(y,mo,0).getDate();
  let wd=0;for(let d=1;d<=dim;d++){const ds=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if(isWorkDay(ds))wd++;}
  const monthStart=`${month}-01`;
  const monthEnd=`${month}-${String(dim).padStart(2,'0')}`;
  const [{data:emps,error:empErr},{data:recs,error:recErr},leaves] = await Promise.all([
    sb.from('employees').select('id,name,login').eq('active',true).order('name'),
    sb.from('attendance').select('employee_id,work_date,start_time,end_time,lunch_start,lunch_end,extra_break_start,extra_break_end,work_seconds,lunch_seconds,extra_break_seconds,extra_break_over_seconds,afk_seconds,late_minutes').gte('work_date',monthStart).lte('work_date',monthEnd).order('work_date'),
    fetchEmployeeLeavesInRange(monthStart, monthEnd)
  ]);
  if(empErr||recErr||!emps)return;
  const leaveDateMap=buildEmployeeLeaveDateMap(leaves, monthStart, monthEnd);
  const recMap=new Map();
  (recs||[]).forEach(r=>{
    if(!recMap.has(r.employee_id))recMap.set(r.employee_id,[]);
    recMap.get(r.employee_id).push(r);
  });
  const selectedEmployeeId=syncMonthlyEmployeeFilter(emps||[]);
  const reportEmployees=selectedEmployeeId==='all'?(emps||[]):(emps||[]).filter(emp=>emp.id===selectedEmployeeId);
  let tL=0,tA=0,tH=0,tB=0;
  monthlyData=[];
  monthlyAttendanceSummary=[];
  const tbody=document.getElementById('mbody');
  const attBody=mVisible?document.getElementById('att_body'):null;
  tbody.innerHTML='';
  if(attBody)attBody.innerHTML='';
  reportEmployees.forEach((emp,i)=>{
    const er=(recMap.get(emp.id)||[]).slice().sort((a,b)=>String(a.work_date).localeCompare(String(b.work_date)));
    let late=0,came=0,half=0,sec=0,breakSec=0,breakOverSec=0,afkSec=0,totalLateMinutes=0;
    const cameDates=new Set();
    const lateDetails=[];
    er.forEach(r=>{
      const startHM=r.start_time?r.start_time.substring(0,5):null;
      const endHM=r.end_time?r.end_time.substring(0,5):null;
      const status=computeStatusByTimes(startHM,endHM,r.late_minutes||0,r.work_seconds||0);
      if(r.start_time){
        came++;
        if(r.work_date)cameDates.add(r.work_date);
      }
      if(status==='yarim_kun')half++;
      if((r.late_minutes||0)>0){
        late++;
        totalLateMinutes+=r.late_minutes||0;
        lateDetails.push({
          date:r.work_date,
          minutes:r.late_minutes||0,
          status:status==='yarim_kun' ? t('b_half') : t('monthly_detail_full_day')
        });
      }
      if(r.work_seconds)sec+=r.work_seconds;
      if(r.extra_break_seconds)breakSec+=r.extra_break_seconds;
      if(r.extra_break_over_seconds)breakOverSec+=r.extra_break_over_seconds;
      if(r.afk_seconds)afkSec+=r.afk_seconds;
    });
    const leaveDates=leaveDateMap.get(emp.id)||new Set();
    const absentDates=getAbsenceDatesForMonth(month,cameDates,leaveDates);
    const abs=absentDates.length;
    const dailyRows=er.map(rec=>({
      date:rec.work_date||'-',
      start:rec.start_time?rec.start_time.substring(0,5):'-',
      end:rec.end_time?rec.end_time.substring(0,5):'-',
      work:rec.work_seconds?secToHMS(rec.work_seconds):'-',
      lunch:rec.lunch_seconds?secToHMS(rec.lunch_seconds):'-',
      breakTime:rec.extra_break_seconds?secToHMS(rec.extra_break_seconds):'-',
      late:rec.late_minutes||0,
      status:computeStatusByTimes(
        rec.start_time?rec.start_time.substring(0,5):null,
        rec.end_time?rec.end_time.substring(0,5):null,
        rec.late_minutes||0,
        rec.work_seconds||0
      )
    }));
    tL+=late;tA+=abs;tH+=sec;tB+=breakSec;
    if(er.length===0){
      monthlyData.push({date:'-',name:emp.name,start:'-',hours:'-',lunchStart:'-',lunchEnd:'-',breakTime:'-',end:'-'});
    }else{
      er.forEach(rec=>{
        monthlyData.push({
          date:rec.work_date||'-',
          name:emp.name,
          start:rec.start_time?rec.start_time.substring(0,5):'-',
          hours:rec.work_seconds?secToHMS(rec.work_seconds):'-',
          lunchStart:rec.lunch_start?rec.lunch_start.substring(0,5):'-',
          lunchEnd:rec.lunch_end?rec.lunch_end.substring(0,5):'-',
          breakTime:rec.extra_break_seconds?secToHMS(rec.extra_break_seconds):'-',
          end:rec.end_time?rec.end_time.substring(0,5):'-'
        });
      });
    }
    monthlyAttendanceSummary.push({
      employeeId:emp.id,
      employeeName:emp.name||'-',
      month,
      came,
      half,
      late,
      breakSec,
      breakOverSec,
      totalLateMinutes,
      absentDates,
      lateDetails,
      dailyRows
    });
    er.forEach(rec=>{
      const tr=document.createElement('tr');
      tr.dataset.name=(emp.name||'').toLowerCase();
      tr.innerHTML=`<td>${tbody.children.length+1}</td><td style="font-family:var(--mono)">${rec.work_date||'-'}</td><td>${emp.name}</td><td style="font-family:var(--mono)">${rec.start_time?rec.start_time.substring(0,5):'-'}</td><td style="font-family:var(--mono)">${rec.work_seconds?secToHMS(rec.work_seconds):'-'}</td><td style="font-family:var(--mono)">${rec.lunch_start?rec.lunch_start.substring(0,5):'-'}</td><td style="font-family:var(--mono)">${rec.lunch_end?rec.lunch_end.substring(0,5):'-'}</td><td style="font-family:var(--mono)">${rec.extra_break_seconds?secToHMS(rec.extra_break_seconds):'-'}</td><td style="font-family:var(--mono)">${rec.end_time?rec.end_time.substring(0,5):'-'}</td>`;
      tbody.appendChild(tr);
    });
    if(er.length===0){
      const tr=document.createElement('tr');
      tr.dataset.name=(emp.name||'').toLowerCase();
      tr.innerHTML=`<td>${tbody.children.length+1}</td><td>-</td><td>${emp.name}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>`;
      tbody.appendChild(tr);
    }

    if(attBody){
      const summaryTr=document.createElement('tr');
      summaryTr.dataset.name=(emp.name||'').toLowerCase();
      summaryTr.dataset.st='monthly';
      summaryTr.innerHTML=`<td>${i+1}</td><td>${emp.name||'-'}</td><td style="font-family:var(--mono)">${emp.login||'-'}</td><td style="font-family:var(--mono)">${month}</td><td>${came} ${t('kun')}</td><td>${late} ${t('marta')}</td><td>${abs} ${t('kun')}</td><td style="font-family:var(--mono)">${breakSec>0?secToHMS(breakSec):'-'}</td><td>${totalLateMinutes>0?`${totalLateMinutes} ${t('daq')}`:'-'}</td><td><button class="bsm bsm-g" onclick="openMonthlyAttendanceDetails('${emp.id}')">${t('details')}</button></td>`;
      attBody.appendChild(summaryTr);
    }
  });
  st('me',''+reportEmployees.length);st('ml',''+tL);st('ma',''+tA);st('mh',formatHm(tH));st('mbreak',formatHm(tB));
  filterAtt();
}

function openMonthlyAttendanceDetails(employeeId){
  const row=monthlyAttendanceSummary.find(item=>item.employeeId===employeeId);
  if(!row)return;
  st('month_att_detail_title', t('monthly_detail_title'));
  st('month_att_detail_subtitle', `${row.employeeName} - ${row.month}`);
  const body=document.getElementById('month_att_detail_body');
  const absentHtml=row.absentDates.length
    ? `<ul style="margin:0;padding-left:18px;color:var(--text2);line-height:1.7;">${row.absentDates.map(ds=>`<li>${fmtD(new Date(ds+'T12:00:00'))}</li>`).join('')}</ul>`
    : `<div style="color:var(--success);font-size:12px">${t('monthly_detail_no_absences')}</div>`;
  const lateHtml=row.lateDetails.length
    ? `<div class="tbl-wrap"><table class="tbl" style="min-width:480px;"><thead><tr><th>${t('detail_date')}</th><th>${t('detail_late_minutes')}</th><th>${t('detail_status')}</th></tr></thead><tbody>${row.lateDetails.map(item=>`<tr><td style="font-family:var(--mono)">${fmtD(new Date(item.date+'T12:00:00'))}</td><td>${item.minutes} ${t('daq')}</td><td>${item.status}</td></tr>`).join('')}</tbody></table></div>`
    : `<div style="color:var(--success);font-size:12px">${t('monthly_detail_no_lates')}</div>`;
  const dailyHtml=row.dailyRows.length
    ? `<div class="tbl-wrap"><table class="tbl" style="min-width:760px;"><thead><tr><th>${t('detail_date')}</th><th>${t('detail_start')}</th><th>${t('detail_end')}</th><th>${t('detail_work')}</th><th>${t('detail_lunch')}</th><th>${t('extra_break')}</th><th>${t('detail_late_minutes')}</th><th>${t('detail_status')}</th></tr></thead><tbody>${row.dailyRows.map(item=>`<tr><td style="font-family:var(--mono)">${item.date==='-'?'-':fmtD(new Date(item.date+'T12:00:00'))}</td><td style="font-family:var(--mono)">${item.start}</td><td style="font-family:var(--mono)">${item.end}</td><td style="font-family:var(--mono)">${item.work}</td><td style="font-family:var(--mono)">${item.lunch}</td><td style="font-family:var(--mono)">${item.breakTime}</td><td>${item.late>0?`${item.late} ${t('daq')}`:'-'}</td><td>${item.status==='yarim_kun'?t('b_half'):item.status==='kechikkan'?t('b_late'):item.status==='keldi'?t('b_came'):t('b_abs')}</td></tr>`).join('')}</tbody></table></div>`
    : `<div style="color:var(--text3);font-size:12px">${t('no_data')}</div>`;
  body.innerHTML=`
    <div class="mst" style="margin-bottom:16px;">
      <div class="ms"><h5>${t('mas_worked_days')}</h5><div class="v">${row.came}</div></div>
      <div class="ms"><h5>${t('mas_late_count')}</h5><div class="v">${row.late}</div></div>
      <div class="ms"><h5>${t('mas_absent_days')}</h5><div class="v">${row.absentDates.length}</div></div>
      <div class="ms"><h5>${t('extra_break_total')}</h5><div class="v">${row.breakSec>0?secToHMS(row.breakSec):'0'}</div></div>
      <div class="ms"><h5>${t('extra_break_over')}</h5><div class="v">${row.breakOverSec>0?secToHMS(row.breakOverSec):'0'}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">
      <div class="box" style="margin:0;">
        <div class="btitle" style="margin-bottom:10px;">${t('monthly_detail_absent_dates')}</div>
        ${absentHtml}
      </div>
      <div class="box" style="margin:0;">
        <div class="btitle" style="margin-bottom:10px;">${t('monthly_detail_late_days')}</div>
        ${lateHtml}
      </div>
    </div>
    <div class="box" style="margin:16px 0 0;">
      <div class="btitle" style="margin-bottom:10px;">${t('monthly_detail_daily')}</div>
      ${dailyHtml}
    </div>
  `;
  document.getElementById('m_month_att_detail').classList.remove('hidden');
}
function closeMonthlyAttendanceDetails(){document.getElementById('m_month_att_detail').classList.add('hidden');}

function showAdminBusy(messageKey){
  let overlay=document.getElementById('adminBusyOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='adminBusyOverlay';
    overlay.className='admin-busy-overlay hidden';
    overlay.innerHTML=`
      <div class="admin-busy-card" role="status" aria-live="polite">
        <span class="admin-busy-spinner"></span>
        <strong id="adminBusyText"></strong>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  const text=document.getElementById('adminBusyText');
  if(text)text.textContent=t(messageKey);
  overlay.classList.remove('hidden');
}
function hideAdminBusy(){
  const overlay=document.getElementById('adminBusyOverlay');
  if(overlay)overlay.classList.add('hidden');
}

async function loadEmpList() {
  const { data: emps, error } = await sb
    .from('employees')
    .select('id,name,login,face_registered')
    .eq('active', true)
    .order('name');

  if (error || !emps) {
    toast('error', t('error_title'), error?.message || t('employees_load_error'));
    return [];
  }
  setAmoCrmActiveEmployees(emps);

  const tbody = document.getElementById('emp_body');
  const leaveSelect = document.getElementById('leave_emp');
  tbody.innerHTML = '';
  if (leaveSelect) leaveSelect.innerHTML = `<option value="">${t('leave_emp_placeholder')}</option>`;

  emps.forEach((emp, i) => {
    const faceStatus = emp.face_registered
      ? '<span style="color:var(--success);font-size:11px">✅ Ro\'yxatda</span>'
      : '<span style="color:var(--text3);font-size:11px">❌ Yo\'q</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${emp.name}</td>
      <td style="font-family:var(--mono)">${emp.login}</td>
      <td style="font-family:var(--mono)">*****</td>
      <td>${faceStatus}</td>
      <td><button class="brd" onclick="delEmp('${emp.id}')">${t('delete')}</button></td>
    `;
    tbody.appendChild(tr);
    if (leaveSelect) {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = emp.name || emp.login || '-';
      leaveSelect.appendChild(opt);
    }
  });
  Array.from(tbody.querySelectorAll('tr td:nth-child(5) span')).forEach(el=>{
    if(/Ro'yxatda|Зарегистрировано|registered/i.test(el.textContent)) el.textContent=`✅ ${t('face_registered_yes')}`;
    else el.textContent=`❌ ${t('face_registered_no')}`;
  });
  await loadEmployeeLeaveAdminList();
  return emps;
}
async function delEmp(id) {
  if (!id) return;
  if (!confirm(t('del_c'))) return;

  showAdminBusy('employee_deleting_wait');
  try {
    const { data: sessData, error: sessErr } = await sb.auth.getSession();
    if (sessErr || !sessData?.session?.access_token) {
      throw new Error(t('admin_session_missing'));
    }

    const res = await fetch(`${FUNCTIONS_BASE}/delete-employee`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessData.session.access_token}`
      },
      body: JSON.stringify({ employee_id: id })
    });

    const raw = await res.text();
    let result = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = { error: raw || 'Noma’lum xato' };
    }

    if (!res.ok) {
      throw new Error(result.error || t('employee_remove_error'));
    }

    toast('success', t('employee_title'), t('employee_removed'));
    const emps = await loadEmpList();
    loadDashboard();
    if (mVisible) loadMonthly();
  } catch (e) {
    console.error('delEmp error:', e);
    toast('error', t('error_title'), e.message || t('employee_remove_error'));
  } finally {
    hideAdminBusy();
  }
}
async function addEmp() {
  const nm = document.getElementById('ne_n').value.trim();
  const email = document.getElementById('ne_l').value.trim().toLowerCase();
  const ps = document.getElementById('ne_p').value.trim();
  if (!nm || !email || !ps) {
    toast('warn', t('error_title'), t('fill_required_short'));
    return;
  }

  showAdminBusy('employee_adding_wait');
  try {
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      toast('error', t('error_title'), t('auth_session_invalid'));
      return;
    }

    const { data: sessData, error: sessErr } = await sb.auth.getSession();
    const token = sessData?.session?.access_token;

    if (!token) {
      toast('error', t('error_title'), t('admin_session_missing'));
      return;
    }

    const payload = {
      name: nm,
      email,
      password: ps
    };

    const res = await fetch(`${FUNCTIONS_BASE}/create-employee`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const raw = await res.text();

    let result = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = { error: raw || 'Noma’lum xato' };
    }

    if (!res.ok) {
      toast('error', t('error_title'), result.error || result.message || t('employee_add_error'));
      return;
    }

    document.getElementById('ne_n').value = '';
    document.getElementById('ne_l').value = '';
    document.getElementById('ne_p').value = '';
    const createdId = result.employee_id || result.id || result.employee?.id || result.employee?.employee_id || result.data?.id || result.data?.employee_id;
    let emps = await loadEmpList();

    toast('success', t('employee_title'), t('employee_added'));
  } catch (e) {
    console.error('addEmp CATCH ERROR:', e);
    toast('error', t('error_title'), e.message || t('system_error'));
  } finally {
    hideAdminBusy();
  }
}
function addHol(){const d=document.getElementById('hol_d').value;if(!d)return;const h=JSON.parse(localStorage.getItem('aloqa_hols')||'[]');if(!h.includes(d))h.push(d);localStorage.setItem('aloqa_hols',JSON.stringify(h));document.getElementById('hol_d').value='';updateHolList();}
function updateHolList(){const h=JSON.parse(localStorage.getItem('aloqa_hols')||'[]');const el=document.getElementById('hol_list');if(!el)return;el.textContent=h.length===0?t('hol_none'):`${t('off_days_prefix')} ${h.join(', ')}`;}
function openEP(id){document.getElementById('ep_id').value=id;document.getElementById('ep_np').value='';document.getElementById('m_ep').classList.remove('hidden');}
function closeEP(){document.getElementById('m_ep').classList.add('hidden');}
async function savePass() {
  const id = document.getElementById('ep_id').value;
  const np = document.getElementById('ep_np').value.trim();

  if (!np) {
    toast('warn', t('password_title'), t('password_enter_new'));
    return;
  }

  showAdminBusy('password_updating_wait');
  try {
    const { data: sessData, error: sessErr } = await sb.auth.getSession();
    if (sessErr || !sessData?.session?.access_token) {
      throw new Error('Admin sessiyasi topilmadi');
    }

    const token = sessData.session.access_token;

    const res = await fetch(`${FUNCTIONS_BASE}/reset-employee-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        employee_id: id,
        new_password: np
      })
    });

    const raw = await res.text();
    let result = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = { error: raw || 'Noma’lum xato' };
    }

    if (!res.ok) {
      throw new Error(result.error || t('password_not_updated'));
    }

    document.getElementById('ep_np').value = '';
    closeEP();
    toast('success', t('password_title'), t('password_updated'));
  } catch (err) {
    console.error('savePass error:', err);
    toast('error', t('error_title'), err.message || t('password_update_error'));
  } finally {
    hideAdminBusy();
  }
}
// ============================================================
