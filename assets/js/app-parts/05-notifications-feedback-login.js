//  PUSH NOTIFICATIONS
// ============================================================
const notifChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('aloqapro_notifications') : null;
let remindersInterval = null;
let notifPollIv = null;
let seenNotifIds = new Set(JSON.parse(localStorage.getItem('aloqa_seen_notif_ids')||'[]'));
let employeeNotifRealtime = null;
let adminRealtime = null;
let amoCrmTaskRealtime = null;
let amoCrmRefreshTimer = null;
let faceControlPollTimer = null;
let todayLunchShift = null;

function lunchPlanLocalKey(){
  const employeeId=CU?.id||'anonymous';
  return `aloqa_lunch_plan_${employeeId}_${todayISO()}`;
}
function loadLunchPlanLocal(){
  try{return JSON.parse(localStorage.getItem(lunchPlanLocalKey())||'null');}catch(e){return null;}
}
function saveLunchPlanLocal(shift){
  localStorage.setItem(lunchPlanLocalKey(), JSON.stringify({shift, work_date:todayISO()}));
}
async function loadTodayLunchPlan(){
  todayLunchShift = null;
  const local = loadLunchPlanLocal();
  if (local?.shift) {
    todayLunchShift = local.shift;
  }
  if (!CU || CU.role !== 'employee') return todayLunchShift;
  try{
    const { data } = await sb
      .from('lunch_plans')
      .select('shift')
      .eq('employee_id', CU.id)
      .eq('work_date', todayISO())
      .maybeSingle();
    if (data?.shift) {
      todayLunchShift = data.shift;
      saveLunchPlanLocal(data.shift);
    }
  }catch(e){
    console.warn('loadTodayLunchPlan:', e.message || e);
  }
  return todayLunchShift;
}
async function ensureLunchShiftPrompt() {
  if (!CU || CU.role !== 'employee' || todayLunchShift) return;
  const mins = getTzTotalMinutes();
  if (mins < (11 * 60 + 40)) return;
  document.getElementById('m_lunch_shift').classList.remove('hidden');
}
async function saveLunchShiftChoice(shift) {
  if (!CU) return;
  try{
    const payload = { employee_id: CU.id, work_date: todayISO(), shift };
    const { error } = await sb.from('lunch_plans').upsert(payload, { onConflict: 'employee_id,work_date' });
    if (error) throw error;
    todayLunchShift = shift;
    saveLunchPlanLocal(shift);
    document.getElementById('m_lunch_shift').classList.add('hidden');
    toast('success', t('lunch_title'), shift === 'shift_1' ? t('lunch_shift_saved_1') : t('lunch_shift_saved_2'));
  }catch(e){
    console.error('saveLunchShiftChoice:', e);
    toast('error', t('lunch_title'), e.message || t('lunch_shift_save_error'));
  }
}

function removeRealtimeChannel(channelRef){
  if(!channelRef)return null;
  try{sb.removeChannel(channelRef);}catch(e){console.warn('removeChannel:',e);}
  return null;
}
function stopRealtimeSubscriptions(){
  employeeNotifRealtime = removeRealtimeChannel(employeeNotifRealtime);
  adminRealtime = removeRealtimeChannel(adminRealtime);
  stopFaceControlPolling();
  stopAmoCrmTaskPage();
}
function subscribeEmployeeRealtime(){
  if(!CU||CU.role!=='employee')return;
  employeeNotifRealtime = removeRealtimeChannel(employeeNotifRealtime);
  employeeNotifRealtime = sb
    .channel(`employee-notifications-${CU.id}`)
    .on('postgres_changes',{
      event:'*',
      schema:REALTIME_SCHEMA,
      table:'notifications',
      filter:`employee_id=eq.${CU.id}`
    }, async payload => {
      await loadNotificationsEmp(payload.eventType==='INSERT');
    })
    .on('postgres_changes',{
      event:'*',
      schema:REALTIME_SCHEMA,
      table:'feedback',
      filter:`employee_id=eq.${CU.id}`
    }, async () => {
      await loadMyFeedback();
    })
    .on('postgres_changes',{
      event:'*',
      schema:REALTIME_SCHEMA,
      table:'settings',
      filter:`key=eq.${FACE_CONTROL_SETTING_KEY}`
    }, async () => {
      const enabled=await loadFaceControlSettings();
      if(enabled&&empState==='working')maybeStartFaceDetection();
    })
    .subscribe();
}
function subscribeAdminRealtime(){
  if(!CU||CU.role!=='admin')return;
  adminRealtime = removeRealtimeChannel(adminRealtime);
  adminRealtime = sb
    .channel('admin-live-updates')
    .on('postgres_changes',{
      event:'*',
      schema:REALTIME_SCHEMA,
      table:'notifications'
    }, async () => {
      await loadNotificationsAdmin();
    })
    .on('postgres_changes',{
      event:'*',
      schema:REALTIME_SCHEMA,
      table:'feedback'
    }, async () => {
      await checkFeedbackBadge();
      const tab=document.getElementById('tab_feedback');
      if(tab&&!tab.classList.contains('hidden'))await loadFeedbackAdmin();
    })
    .subscribe();
}

function saveSeenNotifIds(){
  localStorage.setItem('aloqa_seen_notif_ids', JSON.stringify(Array.from(seenNotifIds).slice(-200)));
}
async function showAppNotification(title, body, extra = {}) {
  try{
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification && Notification.permission === 'granted') {
        await reg.showNotification(title, {
          body,
          icon: './images/logo2.png',
          badge: './images/logo2.png',
          tag: extra.tag || ('aloqapro-' + Date.now()),
          data: extra.data || {},
          renotify: true
        });
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({type:'SHOW_NOTIFICATION', title, body, data:extra.data||{}});
        }
        return;
      }
    }
  }catch(e){}
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: './images/logo2.png' }); } catch(e){}
  }
}
async function requestPushPermission() {
  if (!('Notification' in window)) { toast('warn',t('push_title'),t('push_unsupported')); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    toast('success',t('push_title'),t('push_enabled'));
    scheduleReminders();
    const btn = document.getElementById('enablePushBtn');
    if (btn) btn.style.display = 'none';
  } else {
    toast('warn',t('push_title'),t('push_denied'));
  }
}
function scheduleReminders() {
  checkScheduledNotifs();
  if (remindersInterval) return;
  remindersInterval = setInterval(() => { checkScheduledNotifs(); }, 60000);
}
function startNotificationPolling() {
  if (notifPollIv) return;
  notifPollIv = setInterval(() => { if (CU && CU.role === 'employee') loadNotificationsEmp(true); }, NOTIF_POLL_INTERVAL);
}
let sentToday = {};
function checkScheduledNotifs() {
  if (!CU || CU.role !== 'employee') return;
  const nowParts = getTzParts();
  const h = nowParts.hour, m = nowParts.minute;
  const key = todayISO();
  if (!sentToday[key]) sentToday[key] = {};
  const S = sentToday[key];
  if (h===9&&m===0&&!S.s9){S.s9=true;showAppNotification('AloqaPro',lang==='uz'?'Ishingiz boshlandi! Samarali kun tilaymiz 💼':'Рабочий день начался! Удачного дня 💼');saveNotifToDB('work_start',lang==='uz'?'Ish boshlandi':'Начало работы',lang==='uz'?'Ishingiz boshlandi! Samarali kun tilaymiz':'Рабочий день начался!');}
  if (h===11&&m===40&&!S.s11){
    S.s11=true;
    showAppNotification('AloqaPro',lang==='uz'?'Abed smenasini tanlang 🍽️':'Выберите обеденную смену 🍽️');
    saveNotifToDB(
      'lunch_shift_prompt',
      lang==='uz'?'Abed smenasini tanlang':'Выберите обеденную смену',
      lang==='uz'?'Bugun 1-smena yoki 2-smena abedni tanlang':'Выберите 1-ю или 2-ю смену обеда на сегодня'
    );
    ensureLunchShiftPrompt();
  }
  if (h===17&&m===50&&!S.s17){S.s17=true;showAppNotification('AloqaPro',lang==='uz'?'Ish vaqtingiz yakunlanyabdi! Vazifalarni yakunlang ⏰':'Рабочий день заканчивается! Завершите задачи ⏰');saveNotifToDB('work_end_soon','Ish tugayabdi','Ish vaqtingiz yakunlanyabdi, vazifalarni yakunlang');}
  const breakSec=todayBreakSec();
  if(breakSec>=600&&breakSec<660&&!S.b10){S.b10=true;showAppNotification('AloqaPro','⚠️ '+(lang==='uz'?'10 daqiqa tanaffus':'10 минут перерыва'));}
  if(breakSec>=1200&&breakSec<1260&&!S.b20){S.b20=true;showAppNotification('AloqaPro','⚠️ '+(lang==='uz'?'20 daqiqa tanaffus — 10 daqiqa qoldi!':'20 минут перерыва — осталось 10 минут!'));}
  if(breakSec>=1500&&breakSec<1560&&!S.b25){S.b25=true;showAppNotification('AloqaPro','🔴 '+(lang==='uz'?'25 daqiqa tanaffus! 5 daqiqa qoldi!':'25 минут перерыва! Осталось 5 минут!'));}
  if(breakSec>=1800&&!S.b30){S.b30=true;showAppNotification('AloqaPro','🚨 '+(lang==='uz'?'30 daqiqa tanaffus tugadi! AFK hisoblanmoqda!':'30 минут перерыва истекло! AFK!'));}
  if (!todayLunchShift && h >= 11 && (h < 14 || (h === 14 && m === 0))) ensureLunchShiftPrompt();
}
async function saveNotifToDB(type,title,body){if(!CU)return;try{await sb.from('notifications').insert({employee_id:CU.id,title,body,type});}catch(e){console.warn('saveNotifToDB:',e);}loadNotificationsEmp(false);}
async function adminSendNotif() {
  const btn = document.querySelector('#tab_notif .bb');
  if (btn) btn.disabled = true;
  const empId = document.getElementById('ns_emp').value;
  const title = document.getElementById('ns_title_inp').value.trim();
  const body = document.getElementById('ns_body').value.trim();
  if (!title || !body) {
    toast('warn',t('error_title'),t('notif_fill_required'));
    if (btn) btn.disabled = false;
    return;
  }
  try{
    let targets = [];
    if (empId === 'all') {
      const {data:emps} = await sb.from('employees').select('id');
      targets = (emps||[]).map(e=>e.id);
    } else {
      targets = [empId];
    }
    const inserts = targets.map(eid => ({employee_id:eid, title, body, type:'admin'}));
    if (inserts.length > 0) {
      const {error} = await sb.from('notifications').insert(inserts);
      if(error) { console.error('Notif insert error:',error.message); toast('error',t('error_title'),error.message); if(btn)btn.disabled=false; return; }
    }
    if (notifChannel) notifChannel.postMessage({type:'new-notification', title, body});
    document.getElementById('ns_title_inp').value = '';
    document.getElementById('ns_body').value = '';
    toast('success',t('notif_title'),t('notif_sent_success'));
    loadNotificationsAdmin();
  }catch(e){
    console.error('adminSendNotif error:',e);
    toast('error',t('error_title'),e.message||t('notif_send_error'));
  }finally{
    if(btn)btn.disabled=false;
  }
}
async function loadNotificationsEmp(notifyNew = true) {
  if (!CU) return;
  const {data} = await sb.from('notifications').select('*').eq('employee_id',CU.id).order('sent_at',{ascending:false}).limit(30);
  const c = document.getElementById('notif_list_emp'); if (!c) return;
  const unread = (data||[]).filter(n=>!n.is_read).length;
  const badge = document.getElementById('empNotifBadge');
  const badge2 = document.getElementById('empNotifBadge2');
  if (badge) { badge.textContent = unread; badge.classList.toggle('hidden', unread===0); }
  if (badge2) { badge2.textContent = unread; badge2.classList.toggle('hidden', unread===0); }
  if (!data || data.length===0) { c.innerHTML=emptyText('notifications_empty', true); return; }
  if (notifyNew && Notification.permission === 'granted') {
    for (const n of data.slice().reverse()) {
      if (!seenNotifIds.has(n.id) && !n.is_read) {
        seenNotifIds.add(n.id);
        await showAppNotification(n.title, n.body, { tag: 'notif-'+n.id, data:{id:n.id} });
      }
    }
    saveSeenNotifIds();
  } else {
    data.forEach(n=>seenNotifIds.add(n.id));
    saveSeenNotifIds();
  }
  c.innerHTML = data.map(n=>`
    <div class="notif-item ${n.is_read?'':'unread'}" onclick="markNotifRead('${n.id}')">
      <div class="notif-dot ${n.is_read?'read':''}"></div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-msg">${n.body}</div>
        <div class="notif-time">${new Date(n.sent_at).toLocaleString()}</div>
      </div>
    </div>`).join('');
  normalizeDynamicTranslations(c);
}
async function loadNotificationsAdmin() {
  const {data} = await sb.from('notifications').select('*,employees(name)').order('sent_at',{ascending:false}).limit(50);
  const c = document.getElementById('notif_list_admin'); if (!c) return;
  if (!data||data.length===0){c.innerHTML=emptyText('notifications_empty');return;}
  c.innerHTML=data.map(n=>`<div class="notif-item"><div class="notif-body"><div class="notif-title">${n.title} <span style="color:var(--text3);font-size:11px">→ ${n.employees?.name||'?'}</span></div><div class="notif-msg">${n.body}</div><div class="notif-time">${new Date(n.sent_at).toLocaleString()}</div></div></div>`).join('');
}
async function markNotifRead(id) {
  await sb.from('notifications').update({is_read:true}).eq('id',id);
  loadNotificationsEmp(false);
}
if (notifChannel) {
  notifChannel.onmessage = async (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'new-notification' && Notification.permission === 'granted') {
      await showAppNotification(msg.title || 'AloqaPro', msg.body || '');
    }
  };
}
// ============================================================
//  FEEDBACK
// ============================================================
async function sendFeedback() {
  if (!CU) return;
  const type = document.getElementById('fb_type').value;
  const msg = document.getElementById('fb_msg').value.trim();
  if (!msg) { toast('warn',t('error_title'),t('feedback_write_message')); return; }
  await sb.from('feedback').insert({ employee_id:CU.id, employee_name:CU.name, type, message:msg });
  document.getElementById('fb_msg').value = '';
  toast('success',t('feedback_sent_title'),t('feedback_sent_success'));
  loadMyFeedback();
}
async function loadMyFeedback() {
  if (!CU) return;
  const {data} = await sb.from('feedback').select('*').eq('employee_id',CU.id).order('created_at',{ascending:false}).limit(20);
  const c = document.getElementById('my_feedback_list'); if (!c) return;
  if (!data||data.length===0){c.innerHTML=emptyText('feedback_none_sent');return;}
  c.innerHTML=data.map(fb=>`
    <div class="fb-item ${fb.status==='new'?'new-item':''}">
      <div class="fb-header">
        <span class="fb-type ${fb.type}">${fb.type==='complaint'?'⚠️ Shikoyat':fb.type==='suggestion'?'💡 Taklif':'📝 Boshqa'}</span>
        <span class="fb-date">${new Date(fb.created_at).toLocaleDateString()}</span>
      </div>
      <div class="fb-msg">${fb.message}</div>
      ${fb.admin_reply?`<div class="fb-replied">${t('feedback_admin_reply')} ${fb.admin_reply}</div>`:`<div style="font-size:11px;color:var(--text3)">${t('feedback_waiting')}</div>`}
    </div>`).join('');
  normalizeDynamicTranslations(c);
}
async function loadFeedbackAdmin() {
  const filter = document.getElementById('fb_filter')?.value || '';
  let q = sb.from('feedback').select('*,employees(name)').order('created_at',{ascending:false}).limit(50);
  if (filter==='new') q=q.eq('status','new');
  else if(filter==='replied') q=q.eq('status','replied');
  else if(filter==='complaint') q=q.eq('type','complaint');
  else if(filter==='suggestion') q=q.eq('type','suggestion');
  const {data} = await q;
  const c = document.getElementById('feedback_list_admin'); if (!c) return;
  const newCount = (data||[]).filter(f=>f.status==='new').length;
  const badge = document.getElementById('fbBadge');
  if (badge){badge.textContent=newCount;badge.classList.toggle('hidden',newCount===0);}
  if (!data||data.length===0){c.innerHTML=emptyText('feedback_empty');return;}
  c.innerHTML=data.map(fb=>`
    <div class="fb-item ${fb.status==='new'?'new-item':''}">
      <div class="fb-header">
        <div style="display:flex;align-items:center;gap:8px">
          <strong class="fb-name">${fb.employees?.name||fb.employee_name||'?'}</strong>
          <span class="fb-type ${fb.type}">${fb.type==='complaint'?'⚠️ Shikoyat':fb.type==='suggestion'?'💡 Taklif':'📝 Boshqa'}</span>
        </div>
        <span class="fb-date">${new Date(fb.created_at).toLocaleString()}</span>
      </div>
      <div class="fb-msg">${fb.message}</div>
      ${fb.admin_reply?`<div class="fb-replied">${t('feedback_your_reply')} ${fb.admin_reply}</div>`:`
        <div class="fb-reply-area">
          <textarea id="reply_${fb.id}" placeholder="${t('feedback_reply_placeholder')}"></textarea>
          <button class="bb" style="margin-top:6px;font-size:11px;padding:6px 12px" onclick="replyFeedback('${fb.id}')">${t('feedback_reply_send')}</button>
        </div>`}
    </div>`).join('');
}
async function replyFeedback(id) {
  const ta = document.getElementById('reply_'+id);
  if (!ta || !ta.value.trim()) { toast('warn',t('error_title'),t('reply_write_required')); return; }
  const {data:fb} = await sb.from('feedback').update({admin_reply:ta.value.trim(),status:'replied',replied_at:new Date().toISOString()}).eq('id',id).select().single();
  if (fb) {
    try{ await sb.from('notifications').insert({employee_id:fb.employee_id,title:t('admin_replied_title'),body:ta.value.trim(),type:'admin'}); }catch(e){}
    toast('success',t('reply_title'),t('reply_sent_success'));
    loadFeedbackAdmin();
  }
}

// ============================================================
//  LOGIN
// ============================================================
let CU = null;
const FACE_MATCH_THRESHOLD = 0.36;
let loginInFlight = false;

function normalizeFaceDescriptor(raw){
  if(!raw)return null;
  const arr=Array.from(raw);
  if(arr.length!==128)return null;
  let sumSquares=0;
  for(const value of arr){
    const num=Number(value)||0;
    sumSquares+=num*num;
  }
  const norm=Math.sqrt(sumSquares);
  if(!norm)return new Float32Array(arr);
  return new Float32Array(arr.map(v=>(Number(v)||0)/norm));
}

function getFaceDistance(candidate,saved){
  const candidateNorm=normalizeFaceDescriptor(candidate);
  const savedNorm=normalizeFaceDescriptor(saved);
  if(!candidateNorm||!savedNorm)return Number.POSITIVE_INFINITY;
  return faceapi.euclideanDistance(Array.from(candidateNorm),Array.from(savedNorm));
}

function setLoginButtonLoading(isLoading){
  const lbtn = document.getElementById('lbtn');
  if(!lbtn)return;
  lbtn.disabled = !!isLoading;
  lbtn.classList.toggle('loading', !!isLoading);
  lbtn.innerHTML = isLoading
    ? '<span class="btn-spinner" aria-hidden="true"></span>'
    : `<span id="lbtnLabel">${t('loginBtn')}</span>`;
}

async function doLogin(){
  if(loginInFlight)return;
  const email = document.getElementById('inp_l').value.trim().toLowerCase();
  const ps = document.getElementById('inp_p').value.trim();
  const err = document.getElementById('lerr');
  err.textContent = '';

  if(!email || !ps){
    err.textContent = t('loginFill');
    return;
  }

  setLoginButtonLoading(true);
  loginInFlight = true;

  try {
    // 🔐 AUTH LOGIN
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password: ps
    });

    if (error || !data?.user) {
      err.textContent = t('loginErr');
      loginInFlight = false;
      setLoginButtonLoading(false);
      return;
    }

    const uid = data.user.id;

    // 🔍 ADMIN TEKSHIRISH
    const { data: adm } = await sb
      .from('admins')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();

    if (adm) {
      CU = {...adm, role:'admin'};
      localStorage.setItem('aloqa_u', JSON.stringify(CU));

      loginInFlight = false;
      setLoginButtonLoading(false);

      showPage('admin');
      return;
    }

    // 🔍 EMPLOYEE TEKSHIRISH
    const { data: emp } = await sb
      .from('employees')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();

    if (emp) {
      const access = await checkRegionAccess('employee');

      if (!access.ok) {
        loginInFlight = false;
        setLoginButtonLoading(false);
        showIPBlock(access.value, access.title, access.message);

        await sb.auth.signOut();
        return;
      }

      CU = {...emp, role:'employee'};
      localStorage.setItem('aloqa_u', JSON.stringify(CU));

      loginInFlight = false;
      setLoginButtonLoading(false);

      showPage('employee');
      return;
    }

    err.textContent = t('user_not_linked');
    await sb.auth.signOut();

  } catch (e) {
    console.error(e);
    err.textContent = t('system_error');
  }

  loginInFlight = false;
  setLoginButtonLoading(false);
}
async function doLogout(){
  const pausedForExit=pauseWorkForPlatformExit();
  if(pausedForExit){
    try{await savePartial();}catch(e){console.warn('logout pause save:',e.message||e);}
  }
  stopAll();
  stopFaceDetection();
  stopRealtimeSubscriptions();

  await sb.auth.signOut(); // 🔐 muhim

  CU = null;
  localStorage.removeItem('aloqa_u');

  showPage('login');
}
function toggleEye(){const i=document.getElementById('inp_p');i.type=i.type==='password'?'text':'password';}

const CARD_ANIMATION_SELECTOR=[
  '.login-card',
  '.ip-card',
  '.scard',
  '.box',
  '.dash-card',
  '.dash-amocrm-stat',
  '.dash-amocrm-bar-item',
  '.dash-eff-card',
  '.ec',
  '.ii',
  '.fb-item',
  '.notif-item',
  '.amocrm-dept-card',
  '.amocrm-task-card',
  '.modal'
].join(',');
function shouldReduceMotion(){
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function animateVisibleCards(scope=document){
  if(shouldReduceMotion())return;
  const root=scope && scope.querySelectorAll ? scope : document;
  const cards=Array.from(root.querySelectorAll(CARD_ANIMATION_SELECTOR))
    .filter(el=>el && !el.classList.contains('hidden') && el.offsetParent!==null);
  cards.forEach((el,idx)=>{
    el.classList.remove('card-animate-in');
    el.style.setProperty('--card-delay', `${Math.min(idx,12)*45}ms`);
    void el.offsetWidth;
    el.classList.add('card-animate-in');
  });
}
function animateCurrentView(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const admin=document.getElementById('adminPage');
    const employee=document.getElementById('employeePage');
    const login=document.getElementById('loginPage');
    const ip=document.getElementById('ipBlockPage');
    if(admin && getComputedStyle(admin).display!=='none'){
      const activeTab=document.querySelector('#adminPage .pbody > div:not(.hidden)');
      animateVisibleCards(activeTab || admin);
    }else if(employee && getComputedStyle(employee).display!=='none'){
      animateVisibleCards(employee);
    }else if(login && getComputedStyle(login).display!=='none'){
      animateVisibleCards(login);
    }else if(ip && getComputedStyle(ip).display!=='none'){
      animateVisibleCards(ip);
    }
  }));
}

function showPage(p){
  stopRealtimeSubscriptions();
  document.getElementById('loginPage').style.display=p==='login'?'flex':'none';
  document.getElementById('adminPage').style.display=p==='admin'?'block':'none';
  document.getElementById('employeePage').style.display=p==='employee'?'block':'none';
  document.getElementById('ipBlockPage').style.display='none';
  document.getElementById('faceWidget').classList.toggle('hidden',p!=='employee'||!faceControlEnabled);
  if(p==='admin')initAdmin();
  if(p==='employee')initEmp();
  applyLang();
  animateCurrentView();
}

// ============================================================
//  EMPLOYEE NAV TABS
// ============================================================
function empNavTab(tab){
  ['work','notif','feedback'].forEach(t2=>{const e=document.getElementById('emp_tab_'+t2);if(e)e.classList.toggle('hidden',t2!==tab);});
  // Bottom nav active holati
  ['work','notif','feedback'].forEach(t2=>{const b=document.getElementById('ebn_'+t2);if(b)b.classList.toggle('active',t2===tab);});
  if(tab==='notif')loadNotificationsEmp();
  if(tab==='feedback')loadMyFeedback();
  animateCurrentView();
}

// ============================================================
