// ---- Life OS · gemeinsame Bausteine der Server-Funktionen (wird beim Bauen in jede Funktion kopiert) ----
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

type Doc = { coll: string; id: string; data: any };
type Member = { role: string; name?: string; space?: string | null; hh?: string | null };
type Store = {
  docs(colls: string[]): Promise<Doc[]>;
  get(coll: string, id: string): Promise<any | null>;
  set(coll: string, id: string, data: any): Promise<void>;
  merge(coll: string, id: string, patch: any): Promise<void>;
  del(coll: string, id: string): Promise<void>;
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
    async del(coll, id) { chk(await sb.from('docs').delete().eq('coll', coll).eq('id', id)); },
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
    get: (c, id) => st.get(P(c), id), set: (c, id, d) => st.set(P(c), id, d), merge: (c, id, p) => st.merge(P(c), id, p), del: (c, id) => st.del(P(c), id) };
}
