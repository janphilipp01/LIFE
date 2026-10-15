// Testet die Server-Funktionen mit einem Speicher im Arbeitsspeicher.
// Aufruf: deno run -A test/fn.test.ts
Deno.env.set('LIFEOS_TEST', '1');
const H: any = await import('../supabase/functions/handy/index.ts');
const P: any = await import('../supabase/functions/push/index.ts');
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');
const B = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d);
const T = B(); const add = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function mem() {
  const docs = new Map<string, any>(); const put = (c: string, id: string, d: any) => docs.set(c + '|' + id, { coll: c, id, data: structuredClone(d) });
  const secrets: any = { cron: 'geheim' }; const subs: any[] = []; const uploads: any = {}; let touched = 0;
  const tokens: any = {}; const members: any = { u1: { role: 'owner', name: 'Jan', hh: 'a' }, u2: { role: 'user', name: 'Sophie', space: 'sophie', hh: 'b' }, u3: { role: 'partner', name: 'Gast', hh: 'b' } };
  const st = {
    docs: async (cs: string[]) => [...docs.values()].filter(d => cs.includes(d.coll)).map(d => structuredClone(d)),
    get: async (c: string, id: string) => docs.has(c + '|' + id) ? structuredClone(docs.get(c + '|' + id).data) : null,
    set: async (c: string, id: string, d: any) => put(c, id, d),
    del: async (c: string, id: string) => { docs.delete(c + '|' + id); },
    merge: async (c: string, id: string, p: any) => { const x = docs.get(c + '|' + id); if (!x) throw new Error('nicht gefunden'); Object.assign(x.data, p); },
    member: async (u: string) => members[u] || null, members: async () => Object.entries(members).map(([user_id, m]: any) => ({ user_id, ...m })),
    token: async (h: string) => tokens[h] || null, touch: async () => { touched++; },
    subs: async () => subs, dropSub: async (e: string) => { const i = subs.findIndex(s => s.endpoint === e); if (i >= 0) subs.splice(i, 1); },
    secret: async (k: string) => secrets[k] ?? null, setSecret: async (k: string, v: string) => { secrets[k] = v; },
    upload: async (p: string, b: Uint8Array, t: string) => { uploads[p] = { n: b.length, t }; },
    userFromJwt: async (j: string) => j === 'jwt-jan' ? 'u1' : null,
  };
  return { st, put, docs, secrets, subs, uploads, tokens, get touched() { return touched; } };
}
const M = mem();
const tJan = 'a'.repeat(48), tSo = 'b'.repeat(48), tCal = 'c'.repeat(48), tGast = 'd'.repeat(48);
M.tokens[await hex(tGast)] = { id: 't4', user_id: 'u3', scope: 'handy' };
M.tokens[await hex(tJan)] = { id: 't1', user_id: 'u1', scope: 'handy' };
M.tokens[await hex(tSo)] = { id: 't2', user_id: 'u2', scope: 'handy' };
M.tokens[await hex(tCal)] = { id: 't3', user_id: 'u1', scope: 'kalender' };
M.put('hh', 'main', { names: { a: 'Jan', b: 'Sophie' } });
M.put('hh/main/tasks', 'k1', { title: 'Bad putzen', repeat: 'wiederkehrend', cadence: 7, who: 'abwechselnd', lastBy: 'b', lastDone: add(T, -8), points: '3' });
M.put('hh/main/tasks', 'k2', { title: 'Müll rausbringen', repeat: 'wiederkehrend', cadence: 3, who: 'b', lastDone: add(T, -3) });
M.put('hh/main/shopping', 's1', { item: 'Milch', done: false, category: 'Kühlregal' });
M.put('hh/main/events', 'he1', { title: 'Essen bei Eltern', date: T, time: '19:00', who: 'beide' });
M.put('reminders', 'r1', { title: 'Steuerberater anrufen', due: add(T, -1), status: 'offen' });
M.put('reminders', 'r2', { title: 'Bank', due: T, time: '10:00', status: 'offen' });
M.put('events', 'e1', { title: 'Jour fixe', date: add(T, -14), time: '09:00', end: '10:00', repeat: 'wöchentlich', calendar: 'Privat', exdates: [add(T, -7)] });
M.put('events', 'e2', { title: 'Outlook-Termin', date: T, time: '11:00', calendar: 'Lestate (Outlook)' });
M.put('duties', 'd1', { title: 'USt-VA Q3', due: add(T, 2), status: 'offen', entity: 'JPL Capital UG' });
M.put('invoices', 'i1', { title: 'Handwerker', due: add(T, 1), status: 'offen', amount: 1000 });
M.put('people', 'p1', { name: 'Anna', birthday: '1990-' + T.slice(5) });
M.put('legal', 'g1', { title: 'WEG', timeline: [{ t: 'Erwiderung', date: add(T, 9), kind: 'Frist' }] });
M.put('habits', 'h1', { name: 'Schritte', health: 'steps', healthMin: 8000 });
const call = (q: string, init: any = {}) => H.handle(new Request('https://x.supabase.co/functions/v1/handy?' + q, init), M.st);
const post = (q: string, body: any, tok = tJan) => call(q + '&t=' + tok, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

ok((await call('a=widget')).status === 401, 'ohne Schlüssel abgelehnt');
ok((await call('a=widget&t=' + 'x'.repeat(48))).status === 401, 'falscher Schlüssel abgelehnt');
let r = await post('a=erfassen', { text: 'Steuerberater anrufen morgen 10 Uhr !!' });
ok(r.status === 200 && (await r.text()).startsWith('To-Do angelegt'), 'Siri: To-Do');
ok([...M.docs.values()].some(d => d.coll === 'reminders' && d.data.raw && d.data.source === 'Siri'), 'To-Do mit raw-Kennzeichen (App wertet Datum aus)');
r = await post('a=erfassen', { text: 'Eier, Milch und Butter', art: 'einkauf' }); const t1 = await r.text();
ok(t1.includes('Eier') && t1.includes('Butter') && !t1.includes('Milch'), 'Einkauf: Liste getrennt, Duplikat übersprungen: ' + t1);
r = await post('a=erfassen', { text: 'Heute war gut', art: 'journal' }); await post('a=erfassen', { text: 'Zweiter Gedanke', art: 'journal' });
ok(M.docs.get('journal|' + T).data.text === 'Heute war gut\nZweiter Gedanke', 'Journal ergänzt');
r = await post('a=erfassen', { text: 'Auto waschen', art: 'todo' }, tSo); const tso = await r.text();
ok(tso.startsWith('To-Do angelegt') && [...M.docs.values()].some(d => d.coll === 'u/sophie/reminders' && d.data.title === 'Auto waschen') && ![...M.docs.values()].some(d => d.coll === 'reminders' && d.data.title === 'Auto waschen'), 'Sophie: eigenes To-Do in ihrem Bereich');
r = await post('a=erfassen', { text: 'Fenster putzen', art: 'todo' }, tGast); ok((await r.text()).startsWith('Auf der Einkaufsliste'), 'Nur-Haushalt-Zugang: To-Do wird Einkauf');
r = await call('a=datei&name=Mietvertrag.pdf&t=' + tJan, { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: new Uint8Array([37, 80, 68, 70]) });
ok(r.status === 200 && Object.keys(M.uploads).length === 1 && [...M.docs.values()].some(d => d.coll === 'documents' && d.data.title === 'Mietvertrag' && d.data.inbox), 'Teilen: Datei gespeichert');
ok((await call('a=datei&t=' + tGast, { method: 'POST', body: new Uint8Array([1]) })).status === 403, 'Nur-Haushalt-Zugang: keine Dateien');
r = await call('a=datei&name=Pass.pdf&t=' + tSo, { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: new Uint8Array([1, 2]) });
ok(Object.keys(M.uploads).some(p => p.startsWith('u/sophie/')) && [...M.docs.values()].some(d => d.coll === 'u/sophie/documents' && d.data.fileId.startsWith('u/sophie/')), 'Sophie: Datei in ihrem Bereich');
r = await post('a=health', { schritte: '9.412', gewicht: '82,4', kalorien: 610 });
ok(M.docs.get('health|' + T).data.steps === 9412 && M.docs.get('body|health-' + T).data.weight === 82.4, 'Health: Schritte + Gewicht (deutsches Zahlenformat)');
r = await call('a=erledigt&aufgabe=bad&t=' + tSo); const te = await r.text();
ok(te.includes('Bad putzen erledigt · 3 Punkte') && te.includes('Jan dran'), 'NFC: erledigt + nächste Person: ' + te);
ok(M.docs.get('hh/main/tasks|k1').data.lastBy === 'b' && [...M.docs.values()].some(d => d.coll === 'hh/main/done' && d.data.points === 3), 'Erledigt-Protokoll');
r = await call('a=einkauf&t=' + tJan); const tk = await r.text(); ok(tk.includes('Kühlregal\n• Milch') && tk.includes('• Eier'), 'Einkaufsliste als Text');
r = await call('a=widget&t=' + tJan); const w = await r.json();
ok(w.todos.length === 2 && w.todos[0].ueberfaellig && w.termine.some((e: any) => e.t === 'Jour fixe') && w.gewohnheiten.erledigt === 1, 'Widget Jan: ' + JSON.stringify(w));
r = await call('a=widget&t=' + tSo); const ws = await r.json(); ok(ws.todos && ws.todos.some((x: any) => x.t === 'Auto waschen') === false && ws.haushalt.includes('Müll rausbringen') && ws.termine.length === 1 && !ws.termine.some((e: any) => e.t === 'Jour fixe'), 'Widget Sophie: eigener Bereich + Haushalt, nichts von Jan');
r = await call('a=widget&t=' + tGast); const wg = await r.json(); ok(!wg.todos && wg.haushalt, 'Widget Nur-Haushalt-Zugang');
ok((await call('a=widget&t=' + tCal)).status === 403, 'Kalender-Schlüssel kann nichts anderes');
r = await call('a=kalender&t=' + tCal); const ics = await r.text();
ok(r.headers.get('content-type')!.startsWith('text/calendar') && ics.includes('RRULE:FREQ=WEEKLY') && ics.includes('EXDATE;TZID=Europe/Berlin:' + add(T, -7).replace(/-/g, '')), 'iCal: Serie mit Ausnahme');
ok(!ics.includes('Outlook-Termin') && ics.includes('Frist: USt-VA Q3') && ics.includes('🎂 Anna') && ics.includes('Zahlung: Handwerker') && ics.includes('Frist: Erwiderung') && ics.includes('☐ Bank'), 'iCal: Fristen, Geburtstage, Zahlungen, ohne Outlook-Doppel');
ok(ics.split('\r\n').every(l => l.length <= 75), 'iCal: Zeilen gefaltet');
ok((await (await call('a=kalender&alle=1&t=' + tCal)).text()).includes('Outlook-Termin'), 'iCal: alle=1 inkl. Outlook');
const icsS = await (await call('a=kalender&t=' + tSo)).text(); ok(icsS.includes('Essen bei Eltern') && !icsS.includes('USt') && !icsS.includes('Anna'), 'iCal Sophie: Haushalt, nichts von Jan');
ok(M.touched > 0, 'Zuletzt benutzt wird vermerkt');
// Import für Sophies Bereich
const imp = (body: any, tok = tSo) => call('a=import&t=' + tok, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let ir = await (await imp({ sources: 'Gmail ✓', items: [
  { art: 'mail', id: 'abc@x', betreff: 'Vertrag Yoga', von: 'Studio', datum: T, prioritaet: 'hoch', aktion: 'unterschreiben' },
  { art: 'todo', id: 't1', titel: 'Steuer-ID schicken', faellig: T },
  { art: 'termin', id: 'e1', titel: 'Zahnarzt', datum: T, beginn: '9:30' },
  { art: 'rechnung', id: 'r1', titel: 'Strom', aussteller: 'EON', betrag: '45,90', faellig: T },
  { art: 'quatsch', titel: 'x' }] })).json();
ok(ir.angelegt === 4 && ir.uebersprungen === 1, 'Import: 4 angelegt, 1 übersprungen ' + JSON.stringify(ir));
ok(M.docs.get('u/sophie/mails|m-abcx').data.priority === 'hoch' && M.docs.get('u/sophie/events|ev-e1').data.time === '09:30' && M.docs.get('u/sophie/invoices|inv-r1').data.amount === 45.9, 'Import landet in Sophies Bereich');
ok(![...M.docs.keys()].some(k => k.startsWith('mails|m-abc') || k.startsWith('events|ev-e1')), 'Nichts in Jans Bereich');
M.docs.get('u/sophie/reminders|i-t1').data.status = 'erledigt';
ir = await (await imp({ items: [{ art: 'todo', id: 't1', titel: 'Steuer-ID schicken!', faellig: T }, { art: 'termin', id: 'e1', abgesagt: true }] })).json();
ok(ir.aktualisiert === 1 && ir.geloescht === 1 && M.docs.get('u/sophie/reminders|i-t1').data.status === 'erledigt' && !M.docs.has('u/sophie/events|ev-e1'), 'Wiederholter Import: Status bleibt, Absage löscht');
const st2 = await (await call('a=import&t=' + tSo)).json(); ok(st2.lastRun && M.docs.get('u/sophie/meta|sync').data.sources === 'Gmail ✓', 'Import: Stand abrufbar');
ok((await imp({ items: [] }, tGast)).status === 403, 'Nur-Haushalt-Zugang: kein Import');

// Push
const sent: any[] = []; const sender = async (sub: any, payload: string) => { sent.push({ sub, msg: JSON.parse(payload) }); return sub.gone ? 410 : 201; };
M.put('u/sophie/reminders', 'sr1', { title: 'Yoga buchen', due: T, status: 'offen' });
M.subs.push({ endpoint: 'e-jan', user_id: 'u1', sub: { endpoint: 'e-jan' } }, { endpoint: 'e-so', user_id: 'u2', sub: { endpoint: 'e-so' } }, { endpoint: 'e-alt', user_id: 'u1', sub: { endpoint: 'e-alt', gone: true } });
const preq = (q: string, h: any = {}) => new Request('https://x.supabase.co/functions/v1/push?' + q, { method: 'POST', headers: h });
const key = await (await P.handle(preq('a=key'), M.st, sender)).json(); ok(key.key && JSON.parse(M.secrets.vapid).privateKey, 'Push-Schlüssel automatisch erzeugt');
ok((await P.handle(preq('slot=morgen'), M.st, sender)).status === 401, 'Push ohne Cron-Geheimnis abgelehnt');
const at = (h: number) => { for (let i = 0; i < 48; i++) { const d = new Date(Date.now() + i * 3600e3); if (+new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(d) % 24 === h) return d; } return new Date(); };
let pr = await (await P.handle(preq('slot=auto', { 'x-cron': 'geheim' }), M.st, sender, at(13))).json(); ok(pr.skip === 13, 'Push: außerhalb 7/18 Uhr nichts');
sent.length = 0; pr = await (await P.handle(preq('slot=morgen', { 'x-cron': 'geheim' }), M.st, sender)).json();
const mj = sent.find(s => s.sub.endpoint === 'e-jan'), ms = sent.find(s => s.sub.endpoint === 'e-so');
ok(mj && mj.msg.body.includes('2 To-Dos (1 überfällig)') && mj.msg.body.includes('Frist USt-VA Q3 in 2 Tagen') && mj.msg.body.includes('Rechnung Handwerker morgen') && mj.msg.body.includes('🎂 Anna') && mj.msg.badge === 2, 'Morgen Jan: ' + (mj && mj.msg.body));
ok(ms && ms.msg.body.includes('1 To-Do') && ms.msg.body.includes('Essen bei Eltern') && ms.msg.body.includes('Müll rausbringen') && !ms.msg.body.includes('USt') && !ms.msg.body.includes('Anna'), 'Morgen Sophie: ' + (ms && ms.msg.body));
ok(!M.subs.some(s => s.endpoint === 'e-alt'), 'Abgelaufenes Gerät entfernt');
sent.length = 0; await P.handle(preq('slot=abend', { 'x-cron': 'geheim' }), M.st, sender);
ok(sent.length === 1 && sent[0].sub.endpoint === 'e-so' && sent[0].msg.body === 'Heute noch: Müll rausbringen', 'Abend: nur wer noch etwas offen hat');
sent.length = 0; const tr = await (await P.handle(preq('slot=test', { authorization: 'Bearer jwt-jan' }), M.st, sender)).json(); ok(tr.sent === 1 && sent[0].sub.endpoint === 'e-jan', 'Probe-Mitteilung');
console.log(fails ? `${fails} FEHLER` : 'ALLES OK'); Deno.exit(fails ? 1 : 0);
