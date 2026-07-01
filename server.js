const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv();

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream'
};

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return sendText(res, 204, '');

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (url.pathname === '/env.js') return sendEnv(res);
    if (url.pathname.startsWith('/api/functions/v1/') && req.method === 'POST') {
      return handleFunction(req, res, decodeURIComponent(url.pathname.split('/').pop()));
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`AloqaPro server: http://localhost:${PORT}`);
  console.log('Data source: Supabase');
});

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) return;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}

function sendEnv(res) {
  const config = {
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
    FUNCTIONS_BASE: process.env.FUNCTIONS_BASE || '',
    ENABLE_AMOCRM: parseBool(process.env.ENABLE_AMOCRM),
    ENABLE_ONLINEPBX: parseBool(process.env.ENABLE_ONLINEPBX)
  };
  const body = `window.ALOQA_CONFIG = ${JSON.stringify(config)};\n`;
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function handleFunction(req, res, name) {
  const body = await readJson(req);
  if (name === 'create-employee') return createEmployee(res, body);
  if (name === 'delete-employee') return deleteEmployee(res, body);
  if (name === 'reset-employee-password') return resetEmployeePassword(res, body);
  if (name === 'onlinepbx') return sendJson(res, 200, emptyPbx(body));
  return sendJson(res, 404, { error: `Unknown function: ${name}` });
}

async function createEmployee(res, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '').trim();
  const name = String(body.name || '').trim();
  if (!email || !password || !name) return sendJson(res, 400, { error: 'Name, email and password are required' });

  const user = await supabaseAdmin('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: 'employee' }
    }
  });

  const employee = await supabaseRest('/rest/v1/employees?select=*', {
    method: 'POST',
    body: {
      user_id: user.id,
      name,
      login: email,
      active: true,
      face_registered: false
    },
    prefer: 'return=representation'
  });

  sendJson(res, 200, { ok: true, employee_id: employee?.[0]?.id, employee: employee?.[0] || null });
}

async function deleteEmployee(res, body) {
  const employeeId = body.employee_id || body.id;
  if (!employeeId) return sendJson(res, 400, { error: 'employee_id is required' });
  const rows = await supabaseRest(`/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}&select=user_id`, { method: 'GET' });
  const userId = rows?.[0]?.user_id;
  await supabaseRest(`/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}`, {
    method: 'PATCH',
    body: { active: false },
    prefer: 'return=minimal'
  });
  if (userId) {
    await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: { ban_duration: '876000h' }
    });
  }
  sendJson(res, 200, { ok: true });
}

async function resetEmployeePassword(res, body) {
  const employeeId = body.employee_id;
  const newPassword = String(body.new_password || '').trim();
  if (!employeeId || !newPassword) return sendJson(res, 400, { error: 'employee_id and new_password are required' });
  const rows = await supabaseRest(`/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}&select=user_id`, { method: 'GET' });
  const userId = rows?.[0]?.user_id;
  if (!userId) return sendJson(res, 404, { error: 'Employee auth user not found' });
  await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: { password: newPassword }
  });
  sendJson(res, 200, { ok: true });
}

async function supabaseAdmin(pathname, options = {}) {
  return supabaseFetch(pathname, options, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRest(pathname, options = {}) {
  return supabaseFetch(pathname, options, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseFetch(pathname, options = {}, key) {
  const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!baseUrl || !key) throw new Error('SUPABASE_URL yoki SUPABASE_SERVICE_ROLE_KEY topilmadi');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.prefer ? { Prefer: options.prefer } : {})
  };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }
  if (!response.ok) {
    throw new Error(data?.message || data?.error || response.statusText);
  }
  return data;
}

function emptyPbx(body = {}) {
  return {
    ok: true,
    source: 'disabled',
    filters: body,
    stats: {},
    pagination: { limit: body.limit || 50, offset: body.offset || 0, returned: 0, totalFiltered: 0, hasNext: false, hasPrev: false },
    calls: []
  };
}

function parseBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function serveStatic(requestPath, res) {
  const safePath = requestPath === '/' ? '/index.html' : decodeURIComponent(requestPath);
  const fullPath = path.normalize(path.join(ROOT, safePath));
  if (!fullPath.startsWith(ROOT)) return sendText(res, 403, 'Forbidden');
  fs.readFile(fullPath, (err, data) => {
    if (err) return sendText(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fullPath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}
