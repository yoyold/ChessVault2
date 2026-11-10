# Caissa – Schachdatenbank im Browser

Eine freie, webbasierte Partiedatenbank: Partien importieren, durchsuchen, mit Stockfish analysieren, Partie-Reports erstellen
und die eigenen Fehler gezielt trainieren. Läuft als rein statische Web-App – kein eigener Server nötig.

## Funktionen

- **Übersicht**: letzte Partien, aktuelle Form, Elo, heutiges Training.
- **Datenbank**: Import aus PGN-Dateien (auch große Sammlungen), per Einfügen, von **Lichess** und **Chess.com**. Duplikate werden erkannt.
- **Suchen & Filtern**: Volltextsuche, Weiß/Schwarz (Farben ignorieren), Ergebnis, Jahr, Elo, ECO-Bereich, Eröffnungsname, Zugfolge, Zugzahl, Bedenkzeit, Schlagwörter, Favoriten, „nur mit Report“.
- **Analysebrett**: Live-Analyse mit Stockfish (1–5 Varianten), Bewertungsleiste, Varianten eingeben/hochstufen/löschen, Kommentare, Zugsymbole, Partiedaten bearbeiten, PGN/FEN einfügen und kopieren.
- **Partie-Report**: jeder Zug wird bewertet (Starker Zug … Patzer), Genauigkeit je Seite, Bewertungsgraph, Schlüsselmomente mit besserem Zug.
- **Hintergrundanalyse**: Reports für viele Partien, während man normal weiterarbeitet.
- **Training**: die eigenen Fehler und Patzer als Aufgaben, mit Wiederholungsplan (SM-2: 1, 3, dann wachsende Tage; falsch gelöste nach zehn Minuten).
- **Eröffnungsbaum**: Statistik aus der eigenen Datenbank zu jeder Zugfolge, inklusive passender Partien.
- **Statistik**: Score nach Farbe, Eröffnung (mit Genauigkeit), Gegnerstärke, Jahr, Turnier, Gegner, Bedenkzeit; Elo-Verlauf; Fehler pro Partie; Zeitraumfilter; mehrere eigene Spielernamen.
- **Geräte-Sync** über ein privates GitHub-Repository und **vollständige Sicherung** als Datei.
- Dunkles/helles Design, für Desktop und Mobil.

## Lokal starten

```bash
npm install
npm run dev
```

## Kostenlos hosten (GitHub Pages)

1. Auf GitHub ein Repository anlegen (z. B. `caissa`) und dieses Projekt hineinpushen (Branch `main`).
2. Im Repository: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
3. Der mitgelieferte Workflow `.github/workflows/deploy.yml` baut und veröffentlicht die App bei jedem Push.
   Sie ist danach unter `https://<benutzer>.github.io/<repo>/` erreichbar.

Alternativ funktioniert jeder statische Hoster (Cloudflare Pages, Netlify, Codeberg Pages): Build-Befehl `npm run build`, Ausgabeordner `dist`.

## Sync zwischen Geräten

Der Browser speichert die Datenbank lokal (IndexedDB) als schnellen Arbeitsstand. Damit auf jedem Gerät dieselben Daten liegen,
synchronisiert Caissa sie über ein **privates GitHub-Repository**, das nur dir gehört:

1. Privates Repository anlegen (z. B. `caissa-data`), dabei „Add a README file“ anhaken.
2. Ein *Fine-grained personal access token* erstellen, beschränkt auf dieses Repository, Berechtigung **Contents: Read and write**.
3. In Caissa unter **Einstellungen → Geräte-Sync** Repository (`benutzer/caissa-data`) und Token eintragen – auf jedem Gerät einmal.

Danach läuft der Sync automatisch (beim Start, nach Änderungen, beim Zurückkehren in den Tab). Pro Partie gewinnt die jüngste Änderung;
Löschungen werden mit übertragen. Synchronisiert werden Partien mit Varianten und Kommentaren, Reports, Lernstand des Trainings,
Favoriten und Schlagwörter. Die Daten liegen unverschlüsselt als JSON-Pakete auf dem Branch `caissa-data`; der Branch wird bei jedem
Sync ohne Historie neu geschrieben, damit das Repository nicht anwächst.

## Technik & Lizenzen

React, Vite, TypeScript (MIT) · chess.js (BSD-2) · Chessground (GPL-3.0) · Stockfish 19 lite WASM via stockfish.js (GPL-3.0) ·
Dexie (Apache-2.0) · Schriften Archivo, Source Sans 3, JetBrains Mono (OFL) · Eröffnungsnamen aus lichess-org/chess-openings (CC0).
Caissa selbst steht unter der GPL-3.0-or-later.
