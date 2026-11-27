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

## Data model notes

- Each colour's opening repertoire is one record in the games table with the flag `rep: 'w' | 'b'` (fixed uids
  `repertoire-w` / `repertoire-b`). It is kept out of `state.games` (see `state.reps`) but syncs like a game.
- Position notes are records in the games table too (flag `note`, uid `note-<hash>`), kept in `state.notes`.
- The position index (`src/lib/posindex.ts`, table `posidx`) is derived data: device-local, rebuilt from the
  moves, never synced or backed up.
- Comments have two authors: `Node.comment` (owner) and `Node.botComment` (engine/agent); `Node.vBot` marks a
  variation as machine-made. In PGN both are the command `[%bot]` (see `src/lib/annotator.ts`). A game whose
  `Annotator` header names a bot and carries no marker yet is read as fully machine-annotated.
- The inbox (`inbox/` on the data repo's default branch) merges annotations into an already stored game.
- Changes to a stored game autosave (debounced in `bump()`, flushed when leaving); a new, never-saved game does not.

## Layout and checks

- `src/lib/` – logic (PGN, game tree, engine, report, training, sync, store); `src/components/` – views.
- All sizes in `src/styles.css` go through `calc(N * var(--u))` so the display-size setting scales the whole UI.
- Before pushing: `npm run build` (runs the type check).
