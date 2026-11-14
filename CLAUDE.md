# ChessVault2 – project conventions

## Language

- **Repository language is English**: commit messages, README and other docs, code comments, identifiers, workflow names.
- **The app's user interface stays German.** All user-visible strings (labels, toasts, dialogs, tooltips) are German;
  do not translate them. Some stored values are German too (e.g. the time-control classes `Klassisch`, `Fernschach`).

## Commits

- Commit as the repository owner: `Lukas D <70686089+yoyold@users.noreply.github.com>`.
  No co-author or tool attribution lines in commit messages.
- Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Compatibility – do not rename

Existing users have data under these names; changing them would orphan it:

- IndexedDB database `caissa`, localStorage keys `caissa.settings` / `caissa.sync` / `caissa.lastUser`
- sync branch `caissa-data`, backup file marker `app: 'caissa'`

## Layout and checks

- `src/lib/` – logic (PGN, game tree, engine, report, training, sync, store); `src/components/` – views.
- All sizes in `src/styles.css` go through `calc(N * var(--u))` so the display-size setting scales the whole UI.
- Before pushing: `npm run build` (runs the type check).
