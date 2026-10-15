// Automatisch erzeugt aus src/fn/ – bitte dort ändern (python3 build.py)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

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

// ---- Life OS · Push-Mitteilungen (morgens 7 Uhr, abends 18 Uhr) ----
// Wird stündlich von der Datenbank aufgerufen (setup_push) und sendet nur zu den beiden Zeiten.
// ?a=key liefert den öffentlichen Push-Schlüssel, ?slot=test schickt eine Probe an das eigene Gerät.

async function vapid(st: Store) {
  const s = await st.secret('vapid');
  if (s) return JSON.parse(s);
  const k = webpush.generateVAPIDKeys();
  await st.setSecret('vapid', JSON.stringify(k));
  return k;
}

// Inhalt je Person – reine Funktion, damit sie testbar ist
function compose(C: (c: string) => any[], m: Member, slot: string, today: string) {
  const me = hhOf(m), full = m.role !== 'partner';
  const hh = hhOpenFor(C('hh/main/tasks'), me, today);
  if (slot === 'abend') return hh.length ? { title: 'Haushalt', body: 'Heute noch: ' + hh.map(t => t.title).join(', '), badge: hh.length, url: '/#haushalt' } : null;
  const parts: string[] = [];
  let badge = hh.length, url = '/#haushalt';
  if (full) {
    const todos = C('reminders').filter(r => r.status !== 'erledigt' && r.due && r.due <= today);
    const late = todos.filter(r => r.due < today).length;
    if (todos.length) parts.push(`${todos.length} To-Do${todos.length === 1 ? '' : 's'}${late ? ` (${late} überfällig)` : ''}`);
    const ev = [...C('events'), ...C('hh/main/events')].filter(e => occurs(e, today)).sort((x, y) => (x.time || '') < (y.time || '') ? -1 : 1);
    if (ev.length) parts.push(`${ev.length} Termin${ev.length === 1 ? '' : 'e'}${ev[0].time ? `, erster ${ev[0].time} ${ev[0].title}` : ''}`);
    const rel = (d: string) => { const n = diffDays(today, d); return n < 0 ? 'überfällig' : n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen`; };
    C('duties').filter(d => d.status !== 'erledigt' && (d.extendedTo || d.due) && diffDays(today, d.extendedTo || d.due) <= 3).forEach(d => parts.push(`Frist ${d.title} ${rel(d.extendedTo || d.due)}`));
    C('invoices').filter(i => i.status === 'offen' && i.due && diffDays(today, i.due) <= 3).forEach(i => parts.push(`Rechnung ${i.title || i.issuer} ${rel(i.due)}`));
    C('people').filter(p => p.birthday && p.birthday.slice(5) === today.slice(5)).forEach(p => parts.push(`🎂 ${p.name}`));
    badge = todos.length; url = '/#heute';
  } else {
    const ev = C('hh/main/events').filter(e => occurs(e, today));
    if (ev.length) parts.push(ev.map(e => (e.time ? e.time + ' ' : '') + e.title).join(', '));
  }
  if (hh.length) parts.push('Haushalt: ' + hh.map(t => t.title).join(', '));
  return parts.length ? { title: 'Heute', body: parts.join(' · '), badge, url } : null;
}

type Sender = (sub: any, payload: string, keys: any) => Promise<number>;
const webSender: Sender = async (sub, payload, keys) => {
  webpush.setVapidDetails(Deno.env.get('SUPABASE_URL') || 'https://lifeos.app', keys.publicKey, keys.privateKey);
  try { const r = await webpush.sendNotification(sub, payload, { TTL: 6 * 3600 }); return r.statusCode; } catch (e: any) { return e.statusCode || 500; }
};

async function handle(req: Request, st: Store, send: Sender = webSender, now = new Date()): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  if (u.searchParams.get('a') === 'key') return json({ key: (await vapid(st)).publicKey });
  const keys = await vapid(st);
  const deliver = async (uids: string[], msgFor: (uid: string) => any) => {
    let sent = 0;
    for (const s of (await st.subs()).filter(s => uids.includes(s.user_id))) {
      const msg = msgFor(s.user_id); if (!msg) continue;
      const code = await send(s.sub, JSON.stringify(msg), keys);
      if (code === 404 || code === 410) await st.dropSub(s.endpoint); else if (code < 300) sent++;
    }
    return sent;
  };
  const slotQ = u.searchParams.get('slot') || 'auto';
  if (slotQ === 'test') {
    const uid = await st.userFromJwt((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!uid) return json({ error: 'nicht angemeldet' }, 401);
    const n = await deliver([uid], () => ({ title: 'Life OS', body: 'Mitteilungen sind eingeschaltet. So sieht es um 7 und 18 Uhr aus.', badge: 0, url: '/' }));
    return json({ sent: n });
  }
  if (req.headers.get('x-cron') !== (await st.secret('cron'))) return json({ error: 'nicht erlaubt' }, 401);
  const { date: today, hour } = berlin(now);
  const slot = slotQ === 'auto' ? (hour === 7 ? 'morgen' : hour === 18 ? 'abend' : '') : slotQ;
  if (!slot) return json({ skip: hour });
  const msgs: Record<string, any> = {};
  for (const m of await st.members()) {
    const C = byColl(await scoped(st, m).docs(['reminders', 'events', 'duties', 'invoices', 'people', 'hh/main/tasks', 'hh/main/events']));
    msgs[m.user_id] = compose(C, m, slot, today);
  }
  const sent = await deliver(Object.keys(msgs), uid => msgs[uid]);
  return json({ slot, sent });
}

if (!Deno.env.get('LIFEOS_TEST')) { const st = supaStore(); Deno.serve(req => handle(req, st).catch(e => { console.error(e); return json({ error: e.message }, 500); })); }
export { handle };
