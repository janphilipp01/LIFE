#!/usr/bin/env python3
"""Baut public/index.html aus src/app.html (gemeinsame App-Quelle), src/tplan.json und src/shim.js.
Aufruf: python3 build.py   – danach public/ committen; Vercel liefert public/ statisch aus."""
import re, shutil, pathlib
R = pathlib.Path(__file__).parent
app = (R/'src/app.html').read_text()
app = app.replace('__TPLAN__', (R/'src/tplan.json').read_text())
# Artifact-spezifische Kopfzeilen entfernen
app = re.sub(r'^\s*<title>.*?</title>\s*', '', app, count=1, flags=re.S)
app = re.sub(r'<meta name="claude:[^>]*>\s*', '', app)
HEAD = '''<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>HOME</title>
<meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="HOME">
<meta name="robots" content="noindex,nofollow">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>
html,body{margin:0}
.login{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:24px;background:var(--bg,#F2F2F7);background-image:radial-gradient(60vw 60vw at 85% -10%,rgba(0,122,255,.10),transparent 60%),radial-gradient(50vw 50vw at -10% 40%,rgba(88,86,214,.07),transparent 60%)}
.login-card{width:min(380px,100%);display:flex;flex-direction:column;gap:16px;padding:32px;border-radius:28px;background:var(--glass-card,rgba(255,255,255,.6));-webkit-backdrop-filter:blur(30px);backdrop-filter:blur(30px);border:.5px solid var(--glass-edge,rgba(255,255,255,.75));box-shadow:0 12px 40px rgba(31,38,64,.08)}
.login-card h1{font-size:28px;line-height:34px;margin:0}
.login-card .brand{padding:0;justify-content:flex-start}
.login-msg{margin:0;color:var(--muted,#6e6e73);font-size:14px;line-height:20px}
.login-card .btn{justify-content:center}
.offpill{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 84px);z-index:90;padding:8px 14px;border-radius:999px;font-size:13px;line-height:18px;color:#fff;background:linear-gradient(180deg,#3a3a3c,#1c1c1e);box-shadow:0 6px 20px rgba(0,0,0,.18);pointer-events:none}
@media (min-width:1024px){.offpill{bottom:20px}}
#mobileBox{display:flex;flex-direction:column;gap:28px;min-width:0}
#mobileBox .row{grid-template-columns:minmax(0,1fr) auto;cursor:default}
#mobileBox .card{cursor:default}
#mobileBox .card .list{box-shadow:none;background:transparent}
#mobileBox .card .row{padding:12px 0}
#mobileBox .sync{margin:0}
</style>
<script src="/config.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
<script src="/shim.js"></script>
</head>
<body>
'''
out = HEAD + app + '\n</body>\n</html>\n'
pub = R/'public'; pub.mkdir(exist_ok=True)
(pub/'index.html').write_text(out)
shutil.copy(R/'src/shim.js', pub/'shim.js')
print('public/index.html', len(out)//1024, 'KB')

# Server-Funktionen: gemeinsame Bausteine + Funktion zu je einer eigenständigen Datei zusammensetzen
lib = (R/'src/fn/lib.ts').read_text()
for name in ['handy', 'push']:
    body = (R/f'src/fn/{name}.ts').read_text()
    src = lib + '\n' + body
    imports = [l for l in src.splitlines() if l.startswith('import ')]
    rest = [l for l in src.splitlines() if not l.startswith('import ')]
    out = R/f'supabase/functions/{name}/index.ts'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('// Automatisch erzeugt aus src/fn/ – bitte dort ändern (python3 build.py)\n' + '\n'.join(imports + [''] + rest) + '\nexport { handle };\n')
    print(out.relative_to(R), round(out.stat().st_size/1024), 'KB')
