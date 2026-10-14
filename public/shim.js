// Life OS · Supabase-Anbindung
// Stellt dieselbe Schnittstelle bereit wie der Artifact-Speicher (window.claude.use('db'|'user'|'assets')),
// damit die App-Logik in app.html unverändert in beiden Umgebungen läuft.
(function(){
  "use strict";
  const CFG = window.LIFEOS_CONFIG || {};
  const LOGIN_ID = 'lo-login';
  let resolveReady; const ready = new Promise(r => resolveReady = r);
  window.claude = { use: async name => {
    const ctx = await ready;
    if (name === 'db') return ctx.db;
    if (name === 'user') return { isOwner: () => ctx.role === 'owner', canEdit: () => true, me: () => ({ id: ctx.user.id }) };
    if (name === 'assets') return ctx.role === 'owner' ? ctx.assets : null;
    return null; // sample u. a. gibt es in der eigenen App nicht
  }};

  if (!window.supabase || !CFG.url || !CFG.anonKey) {
    document.addEventListener('DOMContentLoaded', () => showLogin('Die App ist noch nicht konfiguriert (config.js).', true));
    return;
  }
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const clearLocal = () => { try { Object.keys(localStorage).filter(k => k.startsWith('lo.cache.') || k === 'lo.queue').forEach(k => localStorage.removeItem(k)); } catch (e) {} };
  window.__auth = { signOut: async () => { clearLocal(); await sb.auth.signOut(); location.reload(); } };
  window.__fileUrl = async id => { const { data, error } = await sb.storage.from('files').createSignedUrl(id, 600); if (error) throw error; return data.signedUrl; };

  // ---------- Dokumenten-Adapter ----------
  const listeners = new Set();
  const timers = {};
  const refetchColl = coll => { clearTimeout(timers[coll]); timers[coll] = setTimeout(() => { listeners.forEach(l => { if (l.coll === coll) l.fetch(); }); }, 120); };
  const refetchAll = () => listeners.forEach(l => l.fetch());
  const now = () => new Date().toISOString();
  const clean = x => JSON.parse(JSON.stringify(x ?? {}));
  const err = e => { const x = new Error(e.message || String(e)); x.code = e.code; return x; };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : Math.random().toString(36).slice(2) + Date.now().toString(36));

  // ---------- Offline: Zwischenspeicher + Warteschlange ----------
  // Gelesene Daten werden je Sammlung auf dem Gerät gespeichert. Ohne Netz liest die App daraus;
  // Änderungen landen in einer Warteschlange und werden beim nächsten Online-Gang übertragen.
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
               set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
               del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const CK = c => 'lo.cache.' + c, QK = 'lo.queue';
  const cacheGet = c => LS.get(CK(c), {});
  const cachePut = (c, rows, full) => { const m = full ? {} : cacheGet(c); rows.forEach(r => { m[r.id] = r.data; }); LS.set(CK(c), m); };
  const cacheApply = op => { const m = cacheGet(op.coll); if (op.t === 'set') m[op.id] = op.data; else if (op.t === 'update') m[op.id] = { ...(m[op.id] || {}), ...op.data }; else delete m[op.id]; LS.set(CK(op.coll), m); };
  const queue = () => LS.get(QK, []);
  const isNet = e => !navigator.onLine || /fetch|network|load failed|timeout|offline/i.test(String((e && e.message) || e || ''));
  let flushing = false;
  async function runOp(op) {
    if (op.t === 'set') return sb.from('docs').upsert({ coll: op.coll, id: op.id, data: op.data, updated_at: op.at });
    if (op.t === 'update') return sb.rpc('doc_merge', { p_coll: op.coll, p_id: op.id, p_patch: op.data });
    return sb.from('docs').delete().eq('coll', op.coll).eq('id', op.id);
  }
  async function write(op) {
    op.at = now();
    if (navigator.onLine && !queue().length) {
      let res; try { res = await runOp(op); } catch (e) { res = { error: e }; }
      if (!res.error) { cacheApply(op); refetchColl(op.coll); return; }
      if (!isNet(res.error)) throw err(res.error);
    }
    const q = queue(); q.push(op); LS.set(QK, q); cacheApply(op); pill(); refetchColl(op.coll);
  }
  async function flush() {
    if (flushing || !navigator.onLine) return; flushing = true;
    try {
      let q = queue();
      while (q.length) {
        let res; try { res = await runOp(q[0]); } catch (e) { res = { error: e }; }
        if (res.error && isNet(res.error)) break;
        if (res.error) console.warn('Life OS: Offline-Änderung verworfen', q[0], res.error);
        q.shift(); LS.set(QK, q);
      }
    } finally { flushing = false; pill(); refetchAll(); }
  }
  function pill() {
    const n = queue().length, off = !navigator.onLine;
    let el = document.getElementById('lo-offline');
    if (!n && !off) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'lo-offline'; el.className = 'offpill'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = off ? (n ? `Offline · ${n} Änderung${n === 1 ? '' : 'en'} wartet` : 'Offline · zeigt gespeicherten Stand') : `Wird übertragen · ${n}`;
  }
  const offlineQuery = (coll, opt) => {
    let rows = Object.entries(cacheGet(coll)).map(([id, data]) => ({ id, data }));
    (opt.w || []).forEach(([f, op, v]) => { rows = rows.filter(r => { const x = String(r.data[f] ?? ''); v = String(v); return op === '==' ? x === v : op === '!=' ? x !== v : op === '<' ? x < v : op === '<=' ? x <= v : op === '>' ? x > v : op === '>=' ? x >= v : true; }); });
    if (opt.f) rows.sort((a, b) => (String(a.data[opt.f] ?? '') > String(b.data[opt.f] ?? '') ? 1 : -1) * (opt.d === 'desc' ? -1 : 1));
    if (opt.n) rows = rows.slice(0, opt.n);
    return rows;
  };

  function docRef(coll, id) {
    return {
      id,
      async get() {
        const local = () => { const d = cacheGet(coll)[id]; return { id, exists: d !== undefined, data: () => d }; };
        if (!navigator.onLine || queue().length) return local();
        let res; try { res = await sb.from('docs').select('data').eq('coll', coll).eq('id', id).maybeSingle(); } catch (e) { res = { error: e }; }
        if (res.error) { if (isNet(res.error)) return local(); throw err(res.error); }
        const data = res.data; if (data) cachePut(coll, [{ id, data: data.data }]); else { const m = cacheGet(coll); delete m[id]; LS.set(CK(coll), m); }
        return { id, exists: !!data, data: () => data ? data.data : undefined };
      },
      async set(x) { await write({ t: 'set', coll, id, data: clean(x) }); },
      async update(x) {
        if (!navigator.onLine || queue().length) { if (cacheGet(coll)[id] === undefined) { const e = new Error('nicht gefunden'); throw e; } }
        await write({ t: 'update', coll, id, data: clean(x) });
      },
      async delete() { await write({ t: 'delete', coll, id }); },
      onSnapshot(next, onErr) {
        const l = { coll, fetch: async () => { try { const s = await docRef(coll, id).get(); next(s); } catch (e) { onErr && onErr(e); } } };
        listeners.add(l); l.fetch(); return () => listeners.delete(l);
      }
    };
  }
  function query(coll, opt = {}) {
    return {
      orderBy(f, d) { return query(coll, { ...opt, f, d }); },
      limit(n) { return query(coll, { ...opt, n }); },
      where(f, op, v) { return query(coll, { ...opt, w: [...(opt.w || []), [f, op, v]] }); },
      doc(id) { return docRef(coll, id || newId()); },
      async add(x) { const r = docRef(coll, newId()); await r.set(x); return r; },
      async get() {
        const local = () => { const docs = offlineQuery(coll, opt).map(r => ({ id: r.id, exists: true, data: () => r.data })); return { docs, size: docs.length, empty: !docs.length, fromCache: true }; };
        if (!navigator.onLine || queue().length) return local();
        let q = sb.from('docs').select('id,data').eq('coll', coll);
        (opt.w || []).forEach(([f, op, v]) => { const col = 'data->>' + f; const m = { '==': 'eq', '!=': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' }[op]; if (m) q = q[m](col, v); });
        if (opt.f) q = q.order('data->>' + opt.f, { ascending: opt.d !== 'desc' });
        q = q.limit(opt.n || 5000);
        let res; try { res = await q; } catch (e) { res = { error: e }; }
        if (res.error) { if (isNet(res.error)) return local(); throw err(res.error); }
        const data = res.data; cachePut(coll, data || [], !(opt.w || []).length && !opt.n);
        const docs = (data || []).map(r => ({ id: r.id, exists: true, data: () => r.data }));
        return { docs, size: docs.length, empty: !docs.length };
      },
      onSnapshot(next, onErr) {
        const l = { coll, fetch: async () => { try { next(await query(coll, opt).get()); } catch (e) { onErr && onErr(e); } } };
        listeners.add(l); l.fetch(); return () => listeners.delete(l);
      }
    };
  }
  const split = p => { const s = p.split('/'); return [s.slice(0, -1).join('/'), s[s.length - 1]]; };
  const db = { collection: p => query(p), doc: p => { const [c, id] = split(p); return docRef(c, id); } };
  const assets = {
    async upload(file) {
      const safe = String(file.name || 'datei').replace(/[^\w.\-]+/g, '_').slice(-80);
      const id = `${new Date().toISOString().slice(0, 7)}/${newId()}-${safe}`;
      const { error } = await sb.storage.from('files').upload(id, file, { contentType: file.type || undefined, upsert: false });
      if (error) throw err(error);
      return { id, url: null, sizeBytes: file.size, contentType: file.type };
    }
  };

  function subscribeRealtime() {
    sb.channel('docs-all').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
      const c = (p.new && p.new.coll) || (p.old && p.old.coll); if (c) refetchColl(c); else refetchAll();
    }).subscribe();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refetchAll(); });
    window.addEventListener('online', () => { pill(); flush(); });
    window.addEventListener('offline', pill);
  }

  // ---------- Anmeldung ----------
  async function afterLogin(session) {
    const { data, error } = await sb.from('members').select('role,name').eq('user_id', session.user.id).maybeSingle();
    if (error || !data) { showLogin('Dieser Zugang ist noch nicht freigeschaltet. Jan muss ihn in Supabase als Mitglied eintragen.', false, true); return; }
    const prev = LS.get('lo.user', null); if (prev && prev !== session.user.id) clearLocal(); LS.set('lo.user', session.user.id);
    hideLogin(); subscribeRealtime(); pill(); flush();
    resolveReady({ db, assets, role: data.role, user: session.user, name: data.name });
  }
  function hideLogin() { const el = document.getElementById(LOGIN_ID); if (el) el.remove(); }
  function showLogin(msg, fatal, loggedIn) {
    hideLogin();
    const el = document.createElement('div'); el.id = LOGIN_ID; el.className = 'login';
    el.innerHTML = `<form class="login-card" novalidate>
      <div class="brand"><i></i><span>Life OS</span></div>
      <h1>Anmelden</h1>
      ${msg ? `<p class="login-msg">${msg.replace(/</g, '&lt;')}</p>` : ''}
      ${fatal ? '' : loggedIn ? `<button type="button" class="btn" id="loOut">Abmelden</button>` : `
      <div class="field"><label for="loMail">E-Mail</label><input id="loMail" type="email" autocomplete="username" required></div>
      <div class="field"><label for="loPw">Passwort</label><input id="loPw" type="password" autocomplete="current-password" required></div>
      <button class="btn pri" type="submit" id="loGo">Anmelden</button>
      <button class="btn ghost sm" type="button" id="loReset">Passwort vergessen</button>`}
    </form>`;
    document.body.appendChild(el);
    const f = el.querySelector('form');
    const out = el.querySelector('#loOut'); if (out) out.onclick = () => window.__auth.signOut();
    const say = t => { let p = el.querySelector('.login-msg'); if (!p) { p = document.createElement('p'); p.className = 'login-msg'; f.querySelector('h1').after(p); } p.textContent = t; };
    const rs = el.querySelector('#loReset');
    if (rs) rs.onclick = async () => { const m = el.querySelector('#loMail').value.trim(); if (!m) { say('Bitte zuerst die E-Mail eintragen.'); return; } const { error } = await sb.auth.resetPasswordForEmail(m, { redirectTo: location.origin }); say(error ? 'Das hat nicht geklappt: ' + error.message : 'Falls die Adresse bekannt ist, kommt gleich eine Mail mit einem Link zum Zurücksetzen.'); };
    f.addEventListener('submit', async e => {
      e.preventDefault(); const b = el.querySelector('#loGo'); b.disabled = true; b.textContent = 'Anmelden …';
      const { data, error } = await sb.auth.signInWithPassword({ email: el.querySelector('#loMail').value.trim(), password: el.querySelector('#loPw').value });
      b.disabled = false; b.textContent = 'Anmelden';
      if (error) { say('Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.'); return; }
      afterLogin(data.session);
    });
    const m = el.querySelector('#loMail'); if (m) setTimeout(() => m.focus(), 50);
  }
  function showNewPassword() {
    hideLogin();
    const el = document.createElement('div'); el.id = LOGIN_ID; el.className = 'login';
    el.innerHTML = `<form class="login-card"><div class="brand"><i></i><span>Life OS</span></div><h1>Neues Passwort</h1><div class="field"><label for="loNew">Neues Passwort (mind. 10 Zeichen)</label><input id="loNew" type="password" autocomplete="new-password" minlength="10" required></div><p class="login-msg" hidden></p><button class="btn pri" type="submit">Speichern</button></form>`;
    document.body.appendChild(el);
    el.querySelector('form').addEventListener('submit', async e => { e.preventDefault(); const pw = el.querySelector('#loNew').value; const msg = el.querySelector('.login-msg'); if (pw.length < 10) { msg.hidden = false; msg.textContent = 'Mindestens 10 Zeichen.'; return; } const { error } = await sb.auth.updateUser({ password: pw }); if (error) { msg.hidden = false; msg.textContent = error.message; return; } const { data } = await sb.auth.getSession(); afterLogin(data.session); });
  }

  let recovering = false;
  sb.auth.onAuthStateChange((ev, session) => { if (ev === 'PASSWORD_RECOVERY') { recovering = true; showNewPassword(); } if (ev === 'SIGNED_OUT') location.reload(); });
  document.addEventListener('DOMContentLoaded', async () => {
    const { data } = await sb.auth.getSession();
    if (recovering) return;
    if (data.session) afterLogin(data.session); else showLogin('');
  });

  // ---------- App-Installation ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
