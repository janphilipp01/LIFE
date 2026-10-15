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
    try {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { showMfa(session); return; }
    } catch (e) { /* offline: weiter mit gespeichertem Stand */ }
    const prev = LS.get('lo.user', null); if (prev && prev !== session.user.id) clearLocal(); LS.set('lo.user', session.user.id);
    hideLogin(); subscribeRealtime(); pill(); flush();
    CTX = { role: data.role, user: session.user, session };
    resolveReady({ db, assets, role: data.role, user: session.user, name: data.name });
  }
  let CTX = null;
  function showMfa(session) {
    hideLogin();
    const el = document.createElement('div'); el.id = LOGIN_ID; el.className = 'login';
    el.innerHTML = `<form class="login-card"><div class="brand"><i></i><span>Life OS</span></div><h1>Bestätigungscode</h1>
      <p class="login-msg">Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
      <div class="field"><label for="loCode">Code</label><input id="loCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div>
      <button class="btn pri" type="submit" id="loGo">Bestätigen</button><button class="btn ghost sm" type="button" id="loOut">Abmelden</button></form>`;
    document.body.appendChild(el);
    el.querySelector('#loOut').onclick = () => window.__auth.signOut();
    const say = t => { el.querySelector('.login-msg').textContent = t; };
    el.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const code = el.querySelector('#loCode').value.replace(/\D/g, '');
      const { data: f } = await sb.auth.mfa.listFactors(); const fac = f && (f.totp || [])[0];
      if (!fac) { say('Kein Authenticator gefunden.'); return; }
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: fac.id, code });
      if (error) { say('Der Code stimmt nicht. Bitte den aktuellen Code eingeben.'); el.querySelector('#loCode').value = ''; return; }
      const { data } = await sb.auth.getSession(); afterLogin(data.session || session);
    });
    setTimeout(() => el.querySelector('#loCode').focus(), 50);
  }

  // ---------- Handy & Sicherheit (Einstellungen in der App) ----------
  const FN = CFG.url ? CFG.url.replace(/\/$/, '') + '/functions/v1' : '';
  const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const b64u = s => { const pad = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const fmtD = s => s ? new Date(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  let fresh = null; // gerade erzeugter Schlüssel (nur einmal sichtbar)
  async function pushReg() { if (!('serviceWorker' in navigator)) return null; return navigator.serviceWorker.getRegistration(); }
  async function pushState() {
    if (!('PushManager' in window) || !('Notification' in window)) return standalone() ? 'nosupport' : 'install';
    const reg = await pushReg(); const s = reg && await reg.pushManager.getSubscription();
    return s ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off';
  }
  const mobile = {
    async mount(el) {
      if (!el || !CTX) return;
      const owner = CTX.role === 'owner';
      let mfa = null, toks = [], ps = 'off';
      try { const { data } = await sb.auth.mfa.listFactors(); mfa = data; } catch (e) {}
      try { const { data } = await sb.from('device_tokens').select('id,label,scope,created_at,last_used').order('created_at', { ascending: true }); toks = data || []; } catch (e) {}
      try { ps = await pushState(); } catch (e) {}
      const totp = mfa && (mfa.totp || []).find(f => f.status === 'verified');
      const base = FN + '/handy';
      const urls = t => {
        const L = [['Siri: To-Do erfassen (POST, Text)', `${base}?a=erfassen&t=${t}`], ['Siri: Einkauf (POST, Text)', `${base}?a=erfassen&art=einkauf&t=${t}`]];
        if (owner) L.push(['Teilen-Menü: Datei (POST, Datei)', `${base}?a=datei&t=${t}`], ['Apple Health (POST, Werte)', `${base}?a=health&t=${t}`]);
        L.push(['NFC: Aufgabe erledigt', `${base}?a=erledigt&aufgabe=Bad&t=${t}`], ['Einkaufsliste vorlesen', `${base}?a=einkauf&t=${t}`], ['Widget (JSON)', `${base}?a=widget&t=${t}`]);
        return L;
      };
      const cal = t => `${base.replace(/^https:/, 'webcal:')}?a=kalender&t=${t}`;
      el.innerHTML = `
      <section class="panel"><div class="panel-h"><h2>Zwei-Faktor-Anmeldung</h2></div>
        ${totp ? `<p class="sync">Aktiv seit ${fmtD(totp.created_at)}. Ohne Code aus der Authenticator-App kommt niemand an deine Daten, auch nicht mit Passwort.</p><div class="tools"><button class="btn sm" data-mb="mfaoff" data-id="${escH(totp.id)}">Ausschalten</button></div>`
        : `<p class="sync">Schützt deine Finanz- und Mieterdaten zusätzlich zum Passwort. Du brauchst eine Authenticator-App, z. B. die Passwörter-App des iPhones, Google Authenticator oder 1Password.</p><div class="tools"><button class="btn sm pri" data-mb="mfaon">Einrichten</button></div><div id="mbMfa"></div>`}
      </section>
      <section class="panel"><div class="panel-h"><h2>Mitteilungen</h2></div>
        ${ps === 'on' ? `<p class="sync">Eingeschaltet auf diesem Gerät: morgens um 7 Uhr ${owner ? 'To-Dos, Termine, Fristen, Rechnungen, Geburtstage und Haushalt' : 'Haushalt und gemeinsame Termine'}, abends um 18 Uhr, was im Haushalt noch offen ist. Die Zahl am App-Symbol zeigt ${owner ? 'fällige To-Dos' : 'offene Haushaltsaufgaben'}.</p><div class="tools"><button class="btn sm" data-mb="pushtest">Probe senden</button><button class="btn sm" data-mb="pushoff">Ausschalten</button></div>`
        : ps === 'install' ? `<p class="sync">Auf dem iPhone gehen Mitteilungen nur, wenn Life OS als App installiert ist: In Safari auf „Teilen“ → „Zum Home-Bildschirm“, dann die App von dort öffnen und hier einschalten.</p>`
        : ps === 'denied' ? `<p class="sync">Mitteilungen sind für Life OS blockiert. Erlaube sie in den Einstellungen des Geräts (Mitteilungen → Life OS) und lade die App neu.</p>`
        : ps === 'nosupport' ? `<p class="sync">Dieses Gerät oder dieser Browser unterstützt keine Mitteilungen.</p>`
        : `<p class="sync">Morgens um 7 Uhr eine Übersicht, abends um 18 Uhr offene Haushaltsaufgaben.</p><div class="tools"><button class="btn sm pri" data-mb="pushon">Auf diesem Gerät einschalten</button></div>`}
      </section>
      <section class="panel"><div class="panel-h"><h2>Handy-Zugänge</h2></div>
        <p class="sync">Persönliche Schlüssel für Kurzbefehle, Siri, NFC-Sticker, Widget und Kalender-Abo. Jeder Schlüssel lässt sich einzeln löschen; ein Kalender-Schlüssel kann nur den Kalender lesen. Anleitung: <a href="/handy.html" target="_blank" rel="noopener">Handy einrichten</a>.</p>
        ${toks.length ? `<div class="list">${toks.map(t => `<div class="row"><div style="min-width:0"><div class="t">${escH(t.label || 'Handy')}</div><div class="s">${t.scope === 'kalender' ? 'Kalender-Abo' : 'Kurzbefehle & Widget'} · erstellt ${fmtD(t.created_at)} · zuletzt benutzt ${fmtD(t.last_used)}</div></div><button class="btn sm" data-mb="tokdel" data-id="${escH(t.id)}">Löschen</button></div>`).join('')}</div>` : ''}
        ${fresh ? `<div class="card" id="mbFresh"><p class="sync"><b>Neuer Schlüssel – nur jetzt sichtbar.</b> Kopiere die Adressen in deine Kurzbefehle${fresh.scope === 'kalender' ? ' bzw. öffne das Kalender-Abo' : ''}.</p>
          ${fresh.scope === 'kalender' ? `<div class="tools"><a class="btn sm pri" href="${escH(cal(fresh.t))}">Im iPhone-Kalender abonnieren</a><button class="btn sm" data-mb="copy" data-v="${escH(cal(fresh.t))}">Adresse kopieren</button></div><p class="sync">Enthält Life-OS-Termine, Fristen, Zahlungen, Geburtstage, Reisen und Haushalt. Outlook- und iCloud-Termine sind weggelassen, weil sie schon im iPhone-Kalender stehen.</p>`
          : urls(fresh.t).map(([l, u]) => `<div class="row"><div style="min-width:0"><div class="t">${escH(l)}</div><div class="s" style="word-break:break-all">${escH(u)}</div></div><button class="btn sm" data-mb="copy" data-v="${escH(u)}">Kopieren</button></div>`).join('')}
          <div class="tools"><button class="btn sm" data-mb="freshok">Fertig</button></div></div>` : ''}
        <form class="tools" id="mbNew"><input class="inp" name="label" placeholder="Name, z. B. iPhone" aria-label="Name des Zugangs" style="flex:1;min-width:140px"><select class="inp" name="scope" aria-label="Art"><option value="handy">Kurzbefehle & Widget</option><option value="kalender">Kalender-Abo</option></select><button class="btn sm pri" type="submit">Schlüssel erzeugen</button></form>
        ${owner ? `<div class="tools"><a class="btn sm" href="/widget-scriptable.js" download>Widget-Skript (Scriptable)</a></div>` : ''}
      </section>
      ${owner ? `<section class="panel"><div class="panel-h"><h2>Sicherung</h2></div><p class="sync">Jede Nacht wird automatisch eine Kopie aller Daten in der Datenbank abgelegt und 30 Tage aufbewahrt. Zusätzlich kannst du jederzeit eine Datei herunterladen und z. B. in iCloud Drive ablegen.</p><div class="tools"><button class="btn sm" data-mb="backup">Sicherung herunterladen</button></div></section>` : ''}`;
      el.onclick = async ev => {
        const b = ev.target.closest('[data-mb]'); if (!b) return;
        const act = b.dataset.mb; const say = t => (window.__lifeos && window.__lifeos.toast ? window.__lifeos.toast(t) : alert(t));
        try {
          if (act === 'copy') { await navigator.clipboard.writeText(b.dataset.v); say('Kopiert'); return; }
          if (act === 'freshok') { fresh = null; return mobile.mount(el); }
          if (act === 'mfaon') {
            const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Life OS ' + new Date().toISOString().slice(0, 10) });
            if (error) throw error;
            const box = el.querySelector('#mbMfa');
            box.innerHTML = `<div class="card"><p class="sync">1. QR-Code mit der Authenticator-App scannen (auf dem iPhone: Code lange drücken oder den Schlüssel unten in der Passwörter-App eintragen).</p><img alt="QR-Code für die Authenticator-App" src="${escH(data.totp.qr_code)}" style="width:180px;height:180px;background:#fff;border-radius:12px;padding:8px"><p class="sync" style="word-break:break-all">Schlüssel: <b>${escH(data.totp.secret)}</b></p><p class="sync">2. Den angezeigten 6-stelligen Code eingeben:</p><form class="tools" id="mbCode"><input class="inp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" aria-label="Code"><button class="btn sm pri" type="submit">Aktivieren</button></form></div>`;
            box.querySelector('#mbCode').onsubmit = async e2 => {
              e2.preventDefault(); const code = e2.target.elements.code.value.replace(/\D/g, '');
              const { error: er } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code });
              if (er) { say('Code stimmt nicht – bitte den aktuellen eingeben.'); return; }
              say('Zwei-Faktor-Anmeldung ist aktiv'); mobile.mount(el);
            };
            return;
          }
          if (act === 'mfaoff') {
            if (!confirm('Zwei-Faktor-Anmeldung wirklich ausschalten?')) return;
            const { error } = await sb.auth.mfa.unenroll({ factorId: b.dataset.id }); if (error) throw error;
            await sb.auth.refreshSession(); say('Ausgeschaltet'); return mobile.mount(el);
          }
          if (act === 'pushon') {
            if (await Notification.requestPermission() !== 'granted') return mobile.mount(el);
            const reg = await pushReg() || await navigator.serviceWorker.register('/sw.js');
            const { key } = await (await fetch(FN + '/push?a=key')).json();
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
            const j = sub.toJSON();
            const { error } = await sb.from('push_subs').upsert({ endpoint: j.endpoint, user_id: CTX.user.id, sub: j }); if (error) throw error;
            if (owner) { const { error: e3 } = await sb.rpc('setup_push', { p_url: CFG.url.replace(/\/$/, '') }); if (e3) console.warn(e3); }
            say('Mitteilungen eingeschaltet'); return mobile.mount(el);
          }
          if (act === 'pushoff') {
            const reg = await pushReg(); const s = reg && await reg.pushManager.getSubscription();
            if (s) { await sb.from('push_subs').delete().eq('endpoint', s.endpoint); await s.unsubscribe(); }
            say('Mitteilungen ausgeschaltet'); return mobile.mount(el);
          }
          if (act === 'pushtest') {
            const { data } = await sb.auth.getSession();
            const r = await (await fetch(FN + '/push?slot=test', { method: 'POST', headers: { authorization: 'Bearer ' + data.session.access_token } })).json();
            say(r.sent ? 'Probe gesendet' : 'Kein Gerät erreicht'); return;
          }
          if (act === 'tokdel') {
            if (!confirm('Diesen Zugang löschen? Kurzbefehle mit diesem Schlüssel funktionieren danach nicht mehr.')) return;
            const { error } = await sb.from('device_tokens').delete().eq('id', b.dataset.id); if (error) throw error; return mobile.mount(el);
          }
          if (act === 'backup') {
            const { data, error } = await sb.from('docs').select('coll,id,data,updated_at').limit(50000); if (error) throw error;
            const blob = new Blob([JSON.stringify({ app: 'Life OS', exportedAt: new Date().toISOString(), docs: data }, null, 1)], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `LifeOS-Sicherung-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000); return;
          }
        } catch (e) { say('Das hat nicht geklappt: ' + (e.message || e)); }
      };
      const nf = el.querySelector('#mbNew');
      nf.onsubmit = async e => {
        e.preventDefault();
        const { data, error } = await sb.rpc('create_device_token', { p_label: nf.elements.label.value, p_scope: nf.elements.scope.value });
        if (error) { (window.__lifeos && window.__lifeos.toast || alert)(error.message); return; }
        fresh = { t: data, scope: nf.elements.scope.value }; mobile.mount(el);
      };
    }
  };
  window.__mobile = mobile;
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
