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
<title>Life OS</title>
<meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Life OS">
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
