// Automatisch erzeugt aus src/fn/ – bitte dort ändern (python3 build.py)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// ---- Life OS · gemeinsame Bausteine der Server-Funktionen (wird beim Bauen in jede Funktion kopiert) ----

type Doc = { coll: string; id: string; data: any };
type Member = { role: string; name?: string; space?: string | null; hh?: string | null };
type Store = {
  docs(colls: string[]): Promise<Doc[]>;
  get(coll: string, id: string): Promise<any | null>;
  set(coll: string, id: string, data: any): Promise<void>;
  merge(coll: string, id: string, patch: any): Promise<void>;
  member(uid: string): Promise<Member | null>;
  members(): Promise<(Member & { user_id: string })[]>;
  token(hash: string): Promise<{ id: string; user_id: string; scope: string } | null>;
  touch(id: string): Promise<void>;
  subs(): Promise<{ endpoint: string; user_id: string; sub: any }[]>;
  dropSub(endpoint: string): Promise<void>;
  secret(k: string): Promise<string | null>;
  setSecret(k: string, v: string): Promise<void>;
  upload(path: string, body: Uint8Array, type: string): Promise<void>;
  userFromJwt(jwt: string): Promise<string | null>;
};

function supaStore(): Store {
  const url = Deno.env.get('SUPABASE_URL')!;
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const chk = (r: any) => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async docs(colls) { return chk(await sb.from('docs').select('coll,id,data').in('coll', colls).limit(20000)); },
    async get(coll, id) { const d = chk(await sb.from('docs').select('data').eq('coll', coll).eq('id', id).maybeSingle()); return d ? d.data : null; },
    async set(coll, id, data) { chk(await sb.from('docs').upsert({ coll, id, data, updated_at: new Date().toISOString() })); },
    async merge(coll, id, patch) { chk(await sb.rpc('doc_merge', { p_coll: coll, p_id: id, p_patch: patch })); },
    async member(uid) { return chk(await sb.from('members').select('role,name,space,hh').eq('user_id', uid).maybeSingle()); },
    async members() { return chk(await sb.from('members').select('user_id,role,space,hh')); },
    async token(hash) { return chk(await sb.from('device_tokens').select('id,user_id,scope').eq('token_hash', hash).maybeSingle()); },
    async touch(id) { await sb.from('device_tokens').update({ last_used: new Date().toISOString() }).eq('id', id); },
    async subs() { return chk(await sb.from('push_subs').select('endpoint,user_id,sub')); },
    async dropSub(endpoint) { await sb.from('push_subs').delete().eq('endpoint', endpoint); },
    async secret(k) { return chk(await sb.rpc('srv_secret', { p_k: k })); },
    async setSecret(k, v) { chk(await sb.rpc('srv_secret_set', { p_k: k, p_v: v })); },
    async upload(path, body, type) { chk(await sb.storage.from('files').upload(path, body, { contentType: type || 'application/octet-stream', upsert: false })); },
    async userFromJwt(jwt) { const { data } = await sb.auth.getUser(jwt); return data && data.user ? data.user.id : null; },
  };
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const txt = (s: string, status = 200) => new Response(s, { status, headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' } });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });

// Datum/Uhrzeit immer in deutscher Zeit
function berlin(d = new Date()) {
  const p: any = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: (+p.hour) % 24 };
}
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const nowIso = () => new Date().toISOString();
const fdShort = (s: string) => `${+s.slice(8, 10)}.${+s.slice(5, 7)}.`;
const eur = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(+n || 0);

// Findet ein (ggf. wiederkehrender) Termin an Tag d statt?
function occurs(e: any, d: string) {
  if (!e || !e.date) return false;
  const ex = e.exdates || [];
  if (ex.includes(d)) return false;
  if (e.date === d) return true;
  if (!e.repeat || d < e.date || (e.until && d > e.until)) return false;
  const n = diffDays(e.date, d);
  switch (e.repeat) {
    case 'täglich': return true;
    case 'wöchentlich': return n % 7 === 0;
    case 'alle 2 Wochen': return n % 14 === 0;
    case 'monatlich': return e.date.slice(8) === d.slice(8);
    case 'jährlich': return e.date.slice(5) === d.slice(5);
  }
  return false;
}
// Haushaltsaufgaben – gleiche Regeln wie in der App
const hhDue = (t: any, today: string) => t.repeat === 'einmalig' ? (t.due || today) : (t.lastDone ? addDays(t.lastDone, +t.cadence || 7) : today);
const hhWho = (t: any) => t.who === 'abwechselnd' ? (t.lastBy === 'a' ? 'b' : 'a') : (t.who || 'beide');
const hhOpenFor = (tasks: any[], me: string, today: string) => tasks.filter(t => t.status !== 'erledigt' && hhDue(t, today) <= today && t.lastDone !== today && [me, 'beide'].includes(hhWho(t)));
const byColl = (docs: Doc[]) => { const m: Record<string, any[]> = {}; docs.forEach(d => (m[d.coll] = m[d.coll] || []).push({ id: d.id, ...d.data })); return (c: string) => m[c] || []; };

// Jede Person hat einen eigenen Bereich; Haushalt und Reisen sind gemeinsam (gleiche Regeln wie shim.js)
const mapColl = (m: Member, c: string) => c === 'trips' ? 'hh/main/trips' : (c === 'hh' || c.startsWith('hh/')) ? c : (m.role === 'user' && m.space ? `u/${m.space}/${c}` : c);
const filePrefix = (m: Member) => m.role === 'user' && m.space ? `u/${m.space}/` : '';
const hhOf = (m: Member) => m.hh || (m.role === 'owner' ? 'a' : 'b');
function scoped(st: Store, m: Member): Store {
  const P = (c: string) => mapColl(m, c);
  return { ...st,
    async docs(cs) { const back = new Map(cs.map(c => [P(c), c])); return (await st.docs([...back.keys()])).map(d => ({ ...d, coll: back.get(d.coll) || d.coll })); },
    get: (c, id) => st.get(P(c), id), set: (c, id, d) => st.set(P(c), id, d), merge: (c, id, p) => st.merge(P(c), id, p) };
}

// ---- Life OS · Handy-Schnittstelle für Kurzbefehle, Siri, Teilen-Menü, NFC, Widget und Kalender-Abo ----
// Aufruf: https://<projekt>.supabase.co/functions/v1/handy?a=<aktion>&t=<persönlicher Schlüssel>
// Aktionen: erfassen · datei · health · erledigt · einkauf · widget · kalender

const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');
const OUTSIDE_CALS = ['Lestate (Outlook)', 'iCloud']; // stehen ohnehin schon im iPhone-Kalender
const num = (v: any) => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); return isFinite(n) ? n : null; };

async function readBody(req: Request): Promise<any> {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) return await req.json();
    if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const f = await req.formData(); const o: any = {};
      for (const [k, v] of f.entries()) o[k] = v;
      return o;
    }
    const t = await req.text(); return t ? { text: t } : {};
  } catch (_) { return {}; }
}

async function handle(req: Request, st: Store): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  const tok = u.searchParams.get('t') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tok || tok.length < 20) return txt('Schlüssel fehlt.', 401);
  const tk = await st.token(await sha256(tok));
  if (!tk) return txt('Ungültiger oder gelöschter Schlüssel.', 401);
  const m = await st.member(tk.user_id);
  if (!m) return txt('Kein Zugang.', 403);
  await st.touch(tk.id);
  const full = m.role !== 'partner', me = hhOf(m);
  st = scoped(st, m);
  const a = (u.searchParams.get('a') || 'widget').toLowerCase();
  if (tk.scope === 'kalender' && a !== 'kalender') return txt('Dieser Schlüssel gilt nur für das Kalender-Abo.', 403);
  const today = berlin().date;
  const ownerOnly = () => txt('Diese Aktion ist für diesen Zugang nicht freigeschaltet.', 403);

  // ---------- Datei aus dem Teilen-Menü ----------
  if (a === 'datei') {
    if (!full) return ownerOnly();
    let bytes: Uint8Array, type = req.headers.get('content-type') || 'application/octet-stream', name = u.searchParams.get('name') || '';
    if (type.includes('multipart/form-data')) {
      const f = await req.formData(); const file = f.get('datei') || f.get('file');
      if (!file || typeof file === 'string') return txt('Keine Datei erhalten.', 400);
      bytes = new Uint8Array(await (file as File).arrayBuffer()); type = (file as File).type || 'application/octet-stream'; name = name || (file as File).name;
    } else bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return txt('Keine Datei erhalten.', 400);
    if (bytes.length > 25 * 1024 * 1024) return txt('Datei ist größer als 25 MB.', 413);
    const ext = (type.split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg');
    if (!name) name = `Teilen-${today}.${ext}`;
    const safe = name.replace(/[^\w.\-äöüÄÖÜß]+/g, '_').slice(-80);
    const path = `${filePrefix(m)}${today.slice(0, 7)}/${newId()}-${safe}`;
    await st.upload(path, bytes, type);
    const title = name.replace(/\.[a-z0-9]{2,5}$/i, '');
    await st.set('documents', newId(), { title, category: 'Sonstiges', date: today, fileId: path, fileType: type, note: 'Über das Teilen-Menü hinzugefügt', inbox: true, source: 'Teilen', createdAt: nowIso(), updatedAt: nowIso() });
    return txt(`Gespeichert unter Dokumente: ${title}`);
  }

  const body = req.method === 'POST' ? await readBody(req) : {};
  const p = (k: string) => String(body[k] ?? u.searchParams.get(k) ?? '').trim();

  // ---------- Erfassen per Siri / Kurzbefehl ----------
  if (a === 'erfassen') {
    const text = p('text') || p('t2');
    if (!text) return txt('Kein Text erhalten.', 400);
    let art = (p('art') || (full ? 'todo' : 'einkauf')).toLowerCase();
    const link = p('url');
    if (!full && !['einkauf', 'aufgabe'].includes(art)) art = 'einkauf';
    if (art === 'einkauf') {
      const open = (await st.docs(['hh/main/shopping'])).filter(d => !d.data.done).map(d => String(d.data.item || '').toLowerCase());
      const items = text.split(/\n|,|;|\bund\b/i).map(s => s.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
      const added: string[] = [];
      for (const it of items) {
        const item = it.charAt(0).toUpperCase() + it.slice(1);
        if (open.includes(item.toLowerCase())) continue;
        await st.set('hh/main/shopping', newId(), { item, qty: null, category: null, done: false, note: 'Siri', createdAt: nowIso(), updatedAt: nowIso() });
        open.push(item.toLowerCase()); added.push(item);
      }
      return txt(added.length ? `Auf der Einkaufsliste: ${added.join(', ')}` : 'Steht schon auf der Einkaufsliste.');
    }
    if (art === 'aufgabe') {
      await st.set('hh/main/tasks', newId(), { title: text, repeat: 'einmalig', due: today, points: '1', who: me, status: 'offen', createdAt: nowIso(), updatedAt: nowIso() });
      return txt(`Haushaltsaufgabe angelegt: ${text}`);
    }
    if (art === 'journal') {
      const cur = (await st.get('journal', today)) || {};
      const t = (cur.text ? cur.text + '\n' : '') + text;
      await st.set('journal', today, { ...cur, date: today, text: t, updatedAt: nowIso() });
      return txt('Im Journal von heute ergänzt.');
    }
    await st.set('reminders', newId(), { title: text, note: link || '', status: 'offen', repeat: 'einmalig', source: 'Siri', raw: true, createdAt: nowIso(), updatedAt: nowIso() });
    return txt(`To-Do angelegt: ${text}`);
  }

  // ---------- Apple Health ----------
  if (a === 'health') {
    if (!full) return ownerOnly();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(p('datum')) ? p('datum') : today;
    const vals: any = {};
    for (const [k, alias] of [['steps', 'schritte'], ['kcal', 'kalorien'], ['weight', 'gewicht'], ['workouts', 'trainings'], ['sleep', 'schlaf']]) {
      const v = num(body[k] ?? body[alias] ?? u.searchParams.get(k) ?? u.searchParams.get(alias)); if (v !== null) vals[k] = v;
    }
    if (!Object.keys(vals).length) return txt('Keine Werte erhalten (schritte, kalorien, gewicht, trainings, schlaf).', 400);
    const cur = (await st.get('health', date)) || {};
    await st.set('health', date, { ...cur, ...vals, date, updatedAt: nowIso() });
    if (vals.weight) await st.set('body', 'health-' + date, { date, weight: Math.round(vals.weight * 10) / 10, note: 'Apple Health', updatedAt: nowIso() });
    return txt('Gesundheitswerte übernommen: ' + Object.entries(vals).map(([k, v]) => `${({ steps: 'Schritte', kcal: 'kcal', weight: 'kg', workouts: 'Trainings', sleep: 'Std. Schlaf' } as any)[k]} ${new Intl.NumberFormat('de-DE').format(v as number)}`).join(' · '));
  }

  // ---------- Haushaltsaufgabe erledigt (NFC-Sticker) ----------
  if (a === 'erledigt') {
    const q = p('aufgabe').toLowerCase();
    if (!q) return txt('Welche Aufgabe? Parameter „aufgabe“ fehlt.', 400);
    const tasks = (await st.docs(['hh/main/tasks'])).map(d => ({ id: d.id, ...d.data })).filter(t => t.status !== 'erledigt');
    const t = tasks.find(t => String(t.title || '').toLowerCase() === q) || tasks.find(t => String(t.title || '').toLowerCase().includes(q));
    if (!t) return txt(`Keine offene Haushaltsaufgabe „${p('aufgabe')}“ gefunden.`, 404);
    if (t.lastDone === today && t.lastBy === me) return txt(`${t.title} ist heute schon erledigt.`);
    const patch: any = { lastDone: today, lastBy: me, updatedAt: nowIso() };
    if (t.repeat === 'einmalig') patch.status = 'erledigt';
    await st.merge('hh/main/tasks', t.id, patch);
    const pts = +t.points || 1;
    await st.set('hh/main/done', newId(), { task: t.title, by: me, date: today, points: pts, taskId: t.id, source: 'NFC' });
    const names = ((await st.get('hh', 'main')) || {}).names || { a: 'Jan', b: 'Sophie' };
    const next = t.repeat === 'einmalig' ? '' : ` Nächstes Mal am ${fdShort(addDays(today, +t.cadence || 7))}${t.who === 'abwechselnd' ? `, dann ist ${names[me === 'a' ? 'b' : 'a']} dran` : ''}.`;
    return txt(`${t.title} erledigt · ${pts} ${pts === 1 ? 'Punkt' : 'Punkte'}.${next}`);
  }

  // ---------- Einkaufsliste lesen ----------
  if (a === 'einkauf') {
    const items = (await st.docs(['hh/main/shopping'])).map(d => d.data).filter(x => !x.done);
    if (!items.length) return txt('Die Einkaufsliste ist leer.');
    const g: Record<string, string[]> = {};
    items.forEach(x => (g[x.category || 'Sonstiges'] = g[x.category || 'Sonstiges'] || []).push(x.item + (x.qty ? ` (${x.qty})` : '')));
    return txt(Object.entries(g).map(([c, l]) => `${c}\n${l.map(i => '• ' + i).join('\n')}`).join('\n\n'));
  }

  // ---------- Widget ----------
  if (a === 'widget') {
    const C = byColl(await st.docs(full ? ['reminders', 'events', 'habits', 'habitlog', 'health', 'hh/main/shopping', 'hh/main/tasks', 'hh/main/events'] : ['hh/main/shopping', 'hh/main/tasks', 'hh/main/events']));
    const ev = [...(full ? C('events') : []), ...C('hh/main/events')].filter(e => occurs(e, today)).sort((x, y) => (x.time || '') < (y.time || '') ? -1 : 1).map(e => ({ t: e.title, zeit: e.time || '' }));
    const out: any = { datum: today, termine: ev, einkauf: C('hh/main/shopping').filter(x => !x.done).length, haushalt: hhOpenFor(C('hh/main/tasks'), me, today).map(t => t.title) };
    if (full) {
      out.todos = C('reminders').filter(r => r.status !== 'erledigt' && r.due && r.due <= today).sort((x, y) => (x.due + (x.time || '')) < (y.due + (y.time || '')) ? -1 : 1).map(r => ({ t: r.title, zeit: r.time || '', ueberfaellig: r.due < today }));
      const hs = C('habits').filter(h => h.active !== 'nein'); const log = (C('habitlog').find(l => l.id === today) || {}).done || {}; const hv = C('health').find(h => h.id === today) || {};
      const auto = (h: any) => !!h.health && +hv[h.health] >= (+h.healthMin || ({ steps: 10000, kcal: 500, workouts: 1 } as any)[h.health] || 1);
      out.gewohnheiten = { erledigt: hs.filter(h => log[h.id] === true || (!log[h.id] && auto(h))).length, von: hs.length };
    }
    return json(out);
  }

  // ---------- Kalender-Abo (iCal) ----------
  if (a === 'kalender') {
    const alle = u.searchParams.get('alle') === '1';
    const C = byColl(await st.docs(full ? ['events', 'reminders', 'duties', 'invoices', 'legal', 'people', 'trips', 'hh/main/events'] : ['hh/main/events']));
    const ve: string[] = [];
    const esc = (s: any) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const dt = (d: string) => d.replace(/-/g, '');
    const tm = (t: string) => (t || '00:00').replace(':', '').padEnd(4, '0') + '00';
    const plus = (t: string, min: number) => { const [h, m] = (t || '00:00').split(':').map(Number); const x = Math.min(23 * 60 + 59, h * 60 + m + min); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
    const RR: any = { 'täglich': 'FREQ=DAILY', 'wöchentlich': 'FREQ=WEEKLY', 'alle 2 Wochen': 'FREQ=WEEKLY;INTERVAL=2', 'monatlich': 'FREQ=MONTHLY', 'jährlich': 'FREQ=YEARLY' };
    const add = (uid: string, title: string, date: string, o: any = {}) => {
      const L = ['BEGIN:VEVENT', `UID:${uid}@lifeos`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `SUMMARY:${esc(title)}`];
      if (o.time) { L.push(`DTSTART;TZID=Europe/Berlin:${dt(date)}T${tm(o.time)}`, `DTEND;TZID=Europe/Berlin:${dt(date)}T${tm(o.end && o.end > o.time ? o.end : plus(o.time, o.dur || 60))}`); }
      else { L.push(`DTSTART;VALUE=DATE:${dt(date)}`, `DTEND;VALUE=DATE:${dt(addDays(o.to || date, 1))}`, 'TRANSP:TRANSPARENT'); }
      if (o.repeat && RR[o.repeat]) L.push(`RRULE:${RR[o.repeat]}${o.until ? `;UNTIL=${dt(o.until)}T235959Z` : ''}`);
      (o.exdates || []).forEach((x: string) => L.push(o.time ? `EXDATE;TZID=Europe/Berlin:${dt(x)}T${tm(o.time)}` : `EXDATE;VALUE=DATE:${dt(x)}`));
      if (o.place) L.push(`LOCATION:${esc(o.place)}`);
      if (o.note) L.push(`DESCRIPTION:${esc(o.note)}`);
      if (o.alarm) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, `TRIGGER:${o.alarm}`, 'END:VALARM');
      L.push('END:VEVENT'); ve.push(...L);
    };
    const since = addDays(today, -60);
    C('hh/main/events').filter(e => e.date && (e.repeat || e.date >= since)).forEach(e => add('hh-' + e.id, (full ? '🏠 ' : '') + e.title, e.date, { time: e.time, repeat: e.repeat, until: e.until, exdates: e.exdates, note: e.note }));
    if (full) {
      C('events').filter(e => e.date && (alle || !OUTSIDE_CALS.includes(e.calendar)) && (e.repeat || e.date >= since)).forEach(e => add('ev-' + e.id, e.title, e.date, { time: e.time, end: e.end, repeat: e.repeat, until: e.until, exdates: e.exdates, place: e.place, note: e.note }));
      C('reminders').filter(r => r.status !== 'erledigt' && r.due && r.time && r.due >= since).forEach(r => add('todo-' + r.id, '☐ ' + r.title, r.due, { time: r.time, dur: 15 }));
      C('duties').filter(d => d.status !== 'erledigt' && (d.extendedTo || d.due)).forEach(d => add('duty-' + d.id, `Frist: ${d.title}${d.entity ? ' (' + d.entity + ')' : ''}`, d.extendedTo || d.due, { alarm: '-P3D' }));
      C('invoices').filter(i => i.status === 'offen' && i.due).forEach(i => add('inv-' + i.id, `Zahlung: ${i.title || i.issuer} – ${eur(i.amount)}`, i.due, { alarm: '-P1D' }));
      C('legal').forEach(g => (g.timeline || []).forEach((x: any, k: number) => { if (x.kind === 'Frist' && !x.done && x.date) add(`legal-${g.id}-${k}`, `Frist: ${x.t} (${g.title})`, x.date, { alarm: '-P3D' }); }));
      C('people').filter(pp => pp.birthday && /^\d{4}-\d{2}-\d{2}$/.test(pp.birthday)).forEach(pp => add('bday-' + pp.id, `🎂 ${pp.name}`, pp.birthday, { repeat: 'jährlich' }));
      C('trips').filter(t => t.from).forEach(t => add('trip-' + t.id, `✈︎ ${t.title}`, t.from, { to: t.to || t.from }));
    }
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HOME//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${full ? 'HOME' : 'HOME · Haushalt'}`, 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE', ...ve, 'END:VCALENDAR'];
    const fold = (l: string) => { const out: string[] = []; let s = l; while (s.length > 72) { out.push(s.slice(0, 72)); s = ' ' + s.slice(72); } out.push(s); return out.join('\r\n'); };
    return new Response(ics.map(fold).join('\r\n') + '\r\n', { headers: { ...CORS, 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' } });
  }

  return txt('Unbekannte Aktion. Möglich: erfassen, datei, health, erledigt, einkauf, widget, kalender.', 400);
}

if (!Deno.env.get('LIFEOS_TEST')) { const st = supaStore(); Deno.serve(req => handle(req, st).catch(e => { console.error(e); return txt('Fehler: ' + e.message, 500); })); }
export { handle };
