# Life OS

Jans persönliche App für Alltag, Finanzen, Immobilien, Haushalt (mit Sophie), Training und Journal.
Statische Web-App auf Vercel, Daten und Login in Supabase (Region Frankfurt), installierbar auf dem Homescreen.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/app.html` | Die gesamte App (Oberfläche + Logik). **Hier wird entwickelt.** |
| `src/tplan.json` | Trainingsplan (QB-Preseason) |
| `src/shim.js` | Anbindung an Supabase: Login, Dokumentenspeicher, Live-Aktualisierung, Dateien |
| `build.py` | Baut `public/index.html` aus `src/` |
| `public/` | Ausgelieferte Dateien (wird committed, Vercel liefert es statisch aus) |
| `supabase/schema.sql` | Tabellen, Zugriffsregeln (Sophie nur Haushalt), Dateiablage |
| `test/web.test.js` | Test gegen einen nachgebauten Supabase-Client inkl. Zugriffsregeln |

Daten liegen als JSON-Dokumente in `public.docs` (`coll`, `id`, `data`), z. B. `coll = 'transactions'` oder `coll = 'hh/main/tasks'`.
Die App spricht dieselbe Schnittstelle wie der frühere Artifact-Speicher, deshalb läuft `src/app.html` unverändert auch dort.

## Ändern

1. `src/app.html` (oder `src/shim.js`) bearbeiten
2. `python3 build.py`
3. `node test/web.test.js` (benötigt `npm i jsdom`)
4. Committen und pushen – Vercel veröffentlicht automatisch; Pull Requests bekommen eine Vorschau-Adresse.

## Einrichtung (einmalig)

1. Supabase-Projekt (Region Frankfurt) anlegen, `supabase/schema.sql` im SQL-Editor ausführen.
2. Authentication → Sign In / Providers: **„Allow new users to sign up“ ausschalten**.
3. Authentication → Users → „Add user“ für Jan und Sophie (mit Passwort, „Auto Confirm“).
4. Die beiden auskommentierten `insert into public.members …`-Zeilen am Ende von `schema.sql` mit den echten Mailadressen ausführen.
5. `public/config.js`: Project URL und **anon**-Key eintragen (nie den service_role-Key).
6. Authentication → URL Configuration: Site URL = Vercel-Adresse (für „Passwort vergessen“).
7. Vercel: Projekt aus diesem Repository importieren (Framework „Other“, keine weiteren Einstellungen nötig – siehe `vercel.json`).

## Sicherheit

- Zugriff ausschließlich über Login; neue Registrierungen sind gesperrt.
- Zeilenbasierte Zugriffsregeln in der Datenbank: Rolle `owner` alles, Rolle `partner` nur Collections `hh` und `hh/…`; Dateien nur `owner`.
- Datenexporte/-importe (`import/`) sind per `.gitignore` vom Repository ausgeschlossen.

## Offline
Die App startet auch ohne Netz (Service Worker hält App-Hülle und Bibliotheken vor). Gelesene Daten liegen je Sammlung im Browser-Speicher des Geräts; ohne Netz zeigt die App diesen Stand, neue Einträge und Änderungen landen in einer Warteschlange und werden beim nächsten Online-Gang automatisch übertragen. Ein Hinweis unten zeigt „Offline“ und die Zahl wartender Änderungen. Beim Abmelden und beim Wechsel des Kontos wird der lokale Speicher gelöscht.
