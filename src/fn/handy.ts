// ---- Life OS · Handy-Schnittstelle für Kurzbefehle, Siri, Teilen-Menü, NFC, Widget und Kalender-Abo ----
// Aufruf: https://<projekt>.supabase.co/functions/v1/handy?a=<aktion>&t=<persönlicher Schlüssel>
// Aktionen: erfassen · datei · health · erledigt · einkauf · widget · kalender · import

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

  // ---------- Import (z. B. Morgen-Aktualisierung aus dem eigenen Claude-Konto) ----------
  // GET ?a=import → Stand (lastRun). POST JSON { items: [...], sources: "…" } → schreibt nur in den Bereich dieses Schlüssels.
  if (a === 'import') {
    if (!full) return ownerOnly();
    if (req.method !== 'POST') return json({ lastRun: ((await st.get('meta', 'sync')) || {}).lastRun || null, heute: today });
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    const S = (v: any, n = 300) => v === undefined || v === null ? null : String(v).slice(0, n);
    const D = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
    const T = (v: any) => /^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v).padStart(5, '0') : null;
    const ID = (p: string, v: any) => v ? p + String(v).replace(/[^\w-]/g, '').slice(0, 80) : p + newId();
    const pick = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    const out = { angelegt: 0, aktualisiert: 0, geloescht: 0, uebersprungen: 0 };
    for (const it of items) {
      const art = String(it.art || '').toLowerCase(); let coll = '', id = '', data: any = null;
      if (art === 'mail') { coll = 'mails'; id = ID('m-', it.id); data = pick({ subject: S(it.betreff ?? it.subject), from: S(it.von ?? it.from), account: S(it.konto ?? it.account ?? 'Privat', 40), date: D(it.datum ?? it.date), priority: ['hoch', 'mittel', 'niedrig'].includes(it.prioritaet ?? it.priority) ? (it.prioritaet ?? it.priority) : 'mittel', action: S(it.aktion ?? it.action), summary: S(it.zusammenfassung ?? it.summary, 600), link: S(it.link, 500), source: 'Import' }); }
      else if (art === 'todo') { coll = 'reminders'; id = ID('i-', it.id); data = pick({ title: S(it.titel ?? it.title), due: D(it.faellig ?? it.due), time: T(it.uhrzeit ?? it.time), note: S(it.notiz ?? it.note, 1000), repeat: 'einmalig', source: 'Import' }); }
      else if (art === 'termin') {
        coll = 'events'; id = ID('ev-', it.id);
        if (it.abgesagt) { if (await st.get(coll, id)) { await st.del(coll, id); out.geloescht++; } continue; }
        data = pick({ title: S(it.titel ?? it.title), date: D(it.datum ?? it.date), time: T(it.beginn ?? it.time), end: T(it.ende ?? it.end), place: S(it.ort ?? it.place), calendar: S(it.kalender ?? it.calendar ?? 'Privat', 40), repeat: ['täglich', 'wöchentlich', 'alle 2 Wochen', 'monatlich', 'jährlich'].includes(it.wiederholung ?? it.repeat) ? (it.wiederholung ?? it.repeat) : null, until: D(it.bis ?? it.until), source: 'Import' });
      }
      else if (art === 'rechnung') { coll = 'invoices'; id = ID('inv-', it.id); data = pick({ title: S(it.titel ?? it.title), issuer: S(it.aussteller ?? it.issuer), kind: 'Rechnung', amount: num(it.betrag ?? it.amount), due: D(it.faellig ?? it.due), link: S(it.link, 500), source: 'Import' }); }
      else if (art === 'einkauf') { coll = 'hh/main/shopping'; id = ID('s-', it.id); data = pick({ item: S(it.artikel ?? it.item ?? it.titel, 80), done: false, note: 'Import' }); }
      if (!coll || !data || !(data.title || data.subject || data.item)) { out.uebersprungen++; continue; }
      if (coll === 'events' && !data.date) { out.uebersprungen++; continue; }
      const cur = await st.get(coll, id);
      if (cur) { const { status, done, ...rest } = data; await st.merge(coll, id, { ...rest, updatedAt: nowIso() }); out.aktualisiert++; }
      else { await st.set(coll, id, { ...data, ...(coll === 'hh/main/shopping' ? {} : { status: 'offen' }), createdAt: nowIso(), updatedAt: nowIso() }); out.angelegt++; }
    }
    const cur = (await st.get('meta', 'sync')) || {};
    await st.set('meta', 'sync', { ...cur, lastRun: nowIso(), sources: S(body.sources, 200) || cur.sources || 'Import' });
    return json(out);
  }

  return txt('Unbekannte Aktion. Möglich: erfassen, datei, health, erledigt, einkauf, widget, kalender, import.', 400);
}

if (!Deno.env.get('LIFEOS_TEST')) { const st = supaStore(); Deno.serve(req => handle(req, st).catch(e => { console.error(e); return txt('Fehler: ' + e.message, 500); })); }
