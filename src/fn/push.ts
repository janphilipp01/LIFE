// ---- Life OS · Push-Mitteilungen (morgens 7 Uhr, abends 18 Uhr) ----
// Wird stündlich von der Datenbank aufgerufen (setup_push) und sendet nur zu den beiden Zeiten.
// ?a=key liefert den öffentlichen Push-Schlüssel, ?slot=test schickt eine Probe an das eigene Gerät.
import webpush from 'npm:web-push@3.6.7';

async function vapid(st: Store) {
  const s = await st.secret('vapid');
  if (s) return JSON.parse(s);
  const k = webpush.generateVAPIDKeys();
  await st.setSecret('vapid', JSON.stringify(k));
  return k;
}

// Inhalt je Person – reine Funktion, damit sie testbar ist
function compose(C: (c: string) => any[], role: string, slot: string, today: string) {
  const me = role === 'owner' ? 'a' : 'b';
  const hh = hhOpenFor(C('hh/main/tasks'), me, today);
  if (slot === 'abend') return hh.length ? { title: 'Haushalt', body: 'Heute noch: ' + hh.map(t => t.title).join(', '), badge: hh.length, url: '/#haushalt' } : null;
  const parts: string[] = [];
  let badge = hh.length, url = '/#haushalt';
  if (role === 'owner') {
    const todos = C('reminders').filter(r => r.status !== 'erledigt' && r.due && r.due <= today);
    const late = todos.filter(r => r.due < today).length;
    if (todos.length) parts.push(`${todos.length} To-Do${todos.length === 1 ? '' : 's'}${late ? ` (${late} überfällig)` : ''}`);
    const ev = C('events').filter(e => occurs(e, today)).sort((x, y) => (x.time || '') < (y.time || '') ? -1 : 1);
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
  const C = byColl(await st.docs(['reminders', 'events', 'duties', 'invoices', 'people', 'hh/main/tasks', 'hh/main/events']));
  const roles: Record<string, string> = {}; (await st.members()).forEach(m => roles[m.user_id] = m.role);
  const sent = await deliver(Object.keys(roles), uid => compose(C, roles[uid], slot, today));
  return json({ slot, sent });
}

if (!Deno.env.get('LIFEOS_TEST')) { const st = supaStore(); Deno.serve(req => handle(req, st).catch(e => { console.error(e); return json({ error: e.message }, 500); })); }
