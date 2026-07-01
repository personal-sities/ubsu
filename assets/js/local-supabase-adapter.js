(function () {
  const DEFAULT_API_BASE = `${location.origin}/api`;

  function apiBase() {
    return (window.ALOQA_API_BASE || localStorage.getItem('aloqa_api_base') || DEFAULT_API_BASE).replace(/\/$/, '');
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem('aloqa_server_session') || 'null'); }
    catch { return null; }
  }

  function writeSession(session) {
    if (session) localStorage.setItem('aloqa_server_session', JSON.stringify(session));
    else localStorage.removeItem('aloqa_server_session');
  }

  async function request(path, options = {}) {
    const session = readSession();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(`${apiBase()}${path}`, { ...options, headers });
    const text = await res.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; }
    catch { payload = { error: text || res.statusText }; }
    if (!res.ok) {
      const err = new Error(payload.error || payload.message || res.statusText);
      err.status = res.status;
      throw err;
    }
    return payload;
  }

  class QueryBuilder {
    constructor(table) {
      this.table = table;
      this.action = 'select';
      this.columns = '*';
      this.filters = [];
      this.orders = [];
      this.limitValue = null;
      this.payload = null;
      this.options = {};
      this.singleMode = false;
      this.maybeSingleMode = false;
    }

    select(columns = '*') { this.action = this.action || 'select'; this.columns = columns; return this; }
    insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
    update(payload) { this.action = 'update'; this.payload = payload; return this; }
    upsert(payload, options = {}) { this.action = 'upsert'; this.payload = payload; this.options = options; return this; }
    delete() { this.action = 'delete'; return this; }
    eq(column, value) { this.filters.push({ op: 'eq', column, value }); return this; }
    neq(column, value) { this.filters.push({ op: 'neq', column, value }); return this; }
    gte(column, value) { this.filters.push({ op: 'gte', column, value }); return this; }
    lte(column, value) { this.filters.push({ op: 'lte', column, value }); return this; }
    in(column, value) { this.filters.push({ op: 'in', column, value }); return this; }
    order(column, options = {}) { this.orders.push({ column, ascending: options.ascending !== false }); return this; }
    limit(value) { this.limitValue = value; return this; }
    single() { this.singleMode = true; return this; }
    maybeSingle() { this.maybeSingleMode = true; return this; }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }

    async execute() {
      try {
        const body = {
          table: this.table,
          action: this.action,
          columns: this.columns,
          filters: this.filters,
          orders: this.orders,
          limit: this.limitValue,
          payload: this.payload,
          options: this.options,
          single: this.singleMode,
          maybeSingle: this.maybeSingleMode
        };
        return await request('/db/query', { method: 'POST', body: JSON.stringify(body) });
      } catch (error) {
        return { data: this.maybeSingleMode ? null : [], error };
      }
    }
  }

  function createChannel() {
    return {
      on() { return this; },
      subscribe() { return this; },
      unsubscribe() { return Promise.resolve('ok'); }
    };
  }

  window.supabase = {
    createClient() {
      return {
        from(table) { return new QueryBuilder(table); },
        rpc(name, params = {}) {
          return request('/rpc/' + encodeURIComponent(name), { method: 'POST', body: JSON.stringify(params) })
            .catch(error => ({ data: null, error }));
        },
        functions: {
          invoke(name, { body } = {}) {
            return request('/functions/v1/' + encodeURIComponent(name), { method: 'POST', body: JSON.stringify(body || {}) })
              .then(data => ({ data, error: null }))
              .catch(error => ({ data: null, error }));
          }
        },
        auth: {
          async signInWithPassword(credentials) {
            try {
              const data = await request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
              writeSession(data.session);
              return { data: { user: data.user, session: data.session }, error: null };
            } catch (error) {
              writeSession(null);
              return { data: null, error };
            }
          },
          async signOut() { writeSession(null); return { error: null }; },
          async getSession() { return { data: { session: readSession() }, error: null }; },
          async getUser() {
            const session = readSession();
            return { data: { user: session?.user || null }, error: session ? null : new Error('No session') };
          }
        },
        channel: createChannel,
        removeChannel(channel) {
          if (channel?.unsubscribe) channel.unsubscribe();
        }
      };
    }
  };
})();
