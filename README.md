# ChessVault2 – a chess database in the browser

A free, web-based game database: import your games, search and filter them, analyse with Stockfish, generate game
reports and train on your own mistakes. It is a purely static web app – no server of your own is needed.

The user interface is in German.

## Features

- **Overview**: recent games, current form, rating, today's training.
- **Database**: import from PGN files (large collections too), by pasting, or straight from **Lichess** and **Chess.com**. Duplicates are detected.
- **Search and filters**: full-text search, White/Black (optionally ignoring colours), result, year, rating, ECO range, opening name, move sequence, number of moves, time control, tags, favourites, "with report only". Results are coloured from your own point of view.
- **Analysis board**: live Stockfish analysis (1–5 lines), evaluation bar, entering/promoting/deleting variations, editing game details, pasting and copying PGN/FEN.
- **Annotating**: move, position and motif symbols, text before and after a move, coloured arrows and squares (stored as `%cal`/`%csl`).
- **Game report**: every move is classified (great move … blunder), accuracy per side, evaluation graph with hover and click-to-jump, key moments with the better move.
- **Background analysis**: reports for many games while you keep working.
- **Training**: your own mistakes and blunders as exercises, on a spaced-repetition schedule (SM-2: 1, 3, then growing days; failed ones after ten minutes).
- **Tournaments**: your tournaments taken from the database with score, average opponent rating and performance; expandable down to the single game.
- **Opening tree**: statistics from your own database for any move sequence, including matching games.
- **Statistics**: score by colour, opening (with accuracy), opponent strength, year, tournament, opponent and time control; rating history; errors per game; period filter; several own player names.
- **Device sync** through a private GitHub repository and a **full backup** as a file.
- Dark and light theme, adjustable display size, desktop and mobile.

## Run locally

```bash
npm install
npm run dev
```

## Free hosting (GitHub Pages)

1. Push this project to a GitHub repository (branch `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
3. The included workflow `.github/workflows/deploy.yml` builds and publishes the app on every push.
   It is then available at `https://<user>.github.io/<repo>/`.

Any static host works as well (Cloudflare Pages, Netlify, Codeberg Pages): build command `npm run build`, output folder `dist`.

## Sync between devices

The browser keeps the database locally (IndexedDB) as a fast working copy. To have the same data on every device,
ChessVault2 syncs it through a **private GitHub repository** that belongs to you alone:

1. Create a private repository (e.g. `chessvault-data`) and tick "Add a README file".
2. Create a *fine-grained personal access token* limited to that repository, with permission **Contents: Read and write**.
3. In the app, under **Einstellungen → Geräte-Sync**, enter the repository (`user/chessvault-data`) and the token – once per device.

After that the sync runs automatically (on start, after changes, when returning to the tab). Per game the most recent change wins;
deletions are synced too. Synced data: games with variations and comments, reports, training state, favourites and tags.
The data is stored unencrypted as JSON shards on the branch `caissa-data`; the branch is rewritten without history on every sync
so the repository does not grow.

## Tech and licences

React, Vite, TypeScript (MIT) · chess.js (BSD-2) · Chessground (GPL-3.0) · Stockfish 19 lite WASM via stockfish.js (GPL-3.0) ·
Dexie (Apache-2.0) · fonts Archivo, Source Sans 3, JetBrains Mono (OFL) · opening names from lichess-org/chess-openings (CC0).
ChessVault2 itself is licensed under GPL-3.0-or-later.
