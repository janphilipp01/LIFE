// Life OS · Widget für die App „Scriptable“ (iPhone/iPad)
// Einrichtung: Skript in Scriptable einfügen → Widget „Scriptable“ auf den Home-Bildschirm →
// Widget bearbeiten → Script: dieses Skript, Parameter: die Widget-Adresse aus Life OS (Einstellungen → Handy & Sicherheit).
// Optional nach einem Leerzeichen die Adresse der App, damit ein Tipp aufs Widget Life OS öffnet.
const [URL_, APP] = (args.widgetParameter || '').trim().split(/\s+/);
const fam = config.widgetFamily || 'medium';
const w = new ListWidget();
const dark = Device.isUsingDarkAppearance();
const C = { bg: dark ? new Color('#1c1c1e') : new Color('#f2f2f7'), fg: dark ? Color.white() : Color.black(), mut: new Color('#8e8e93'), red: new Color('#ff3b30'), acc: new Color('#007aff') };
w.backgroundColor = C.bg; w.setPadding(14, 14, 14, 14); if (APP) w.url = APP;
const head = (t) => { const x = w.addText(t); x.font = Font.semiboldSystemFont(13); x.textColor = C.mut; };
const line = (t, color, size = 14) => { const x = w.addText(t); x.font = Font.systemFont(size); x.textColor = color || C.fg; x.lineLimit = 1; };
if (!URL_) {
  head('Life OS'); w.addSpacer(6); line('Widget-Adresse als Parameter eintragen', C.mut, 12);
} else {
  try {
    const d = await new Request(URL_).loadJSON();
    const date = new Date(d.datum + 'T12:00:00');
    const t = w.addText(date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }));
    t.font = Font.boldSystemFont(fam === 'small' ? 15 : 17); t.textColor = C.fg; w.addSpacer(6);
    const max = fam === 'small' ? 3 : fam === 'large' ? 12 : 5; let used = 0;
    for (const e of (d.termine || [])) { if (used >= max) break; line(`${e.zeit || 'ganztägig'}  ${e.t}`, C.acc, 13); used++; }
    for (const r of (d.todos || [])) { if (used >= max) break; line(`${r.ueberfaellig ? '! ' : '☐ '}${r.t}${r.zeit ? ' · ' + r.zeit : ''}`, r.ueberfaellig ? C.red : C.fg, 13); used++; }
    for (const h of (d.haushalt || [])) { if (used >= max) break; line('🏠 ' + h, C.fg, 13); used++; }
    if (!used) line('Heute ist nichts offen ✓', C.mut, 13);
    w.addSpacer();
    const foot = [];
    if (d.todos) foot.push(`${d.todos.length} To-Do${d.todos.length === 1 ? '' : 's'}`);
    if (d.gewohnheiten && d.gewohnheiten.von) foot.push(`Gewohnheiten ${d.gewohnheiten.erledigt}/${d.gewohnheiten.von}`);
    if (d.einkauf) foot.push(`Einkauf ${d.einkauf}`);
    const f = w.addText(foot.join(' · ')); f.font = Font.systemFont(11); f.textColor = C.mut;
  } catch (e) { head('Life OS'); w.addSpacer(6); line('Nicht erreichbar – später erneut', C.mut, 12); }
}
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
Script.setWidget(w); if (config.runsInApp) await (fam === 'small' ? w.presentSmall() : w.presentMedium());
Script.complete();
