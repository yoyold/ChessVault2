---
name: chessvault-inbox
description: Save chess games (PGN) into the owner's ChessVault2 database. Use when the user asks to save, store, add or send a chess game, a PGN, an annotated analysis or a set of games to ChessVault (ChessVault2, "my chess database"). Not for reading games back.
---

# Save games to ChessVault2

ChessVault2 is the owner's chess database (a web app). It has an **inbox**: any PGN file committed to the
folder `inbox/` of the owner's data repository on GitHub is imported automatically the next time the app
syncs (when it is opened, and every few minutes while it is open). Imported games get the tag `Eingang`;
duplicates are skipped; the file is deleted from the inbox afterwards.

## How to save

1. Write the game(s) as standard PGN to a file. Several games may go in one file, separated by a blank line.
2. Run the helper script that sits next to this file:

   ```bash
   bash <skill-dir>/save_pgn.sh /path/to/games.pgn "short-label"
   ```

   or pipe PGN in: `printf '%s' "$PGN" | bash <skill-dir>/save_pgn.sh - "short-label"`.
3. Tell the user the game was sent to the ChessVault2 inbox and will appear after the next sync, tagged
   "Eingang".

The script needs `CHESSVAULT_REPO` (e.g. `yourname/chessvault-data`) and `CHESSVAULT_TOKEN` in the
environment. If either is missing, ask the user to set them; never print or echo the token.

## PGN rules that matter for the import

- Include the seven standard tags: `Event`, `Site`, `Date`, `Round`, `White`, `Black`, `Result`.
  Add `WhiteElo`, `BlackElo`, `TimeControl`, `ECO` when known.
- **Date as `YYYY.MM.DD`** (use `??` for unknown parts, e.g. `2026.05.??`).
- Player names as `Last, First` and spelled exactly as in the owner's other games – the app recognises the
  owner's own games by name. For a tournament, use exactly the same `Event` name for every round, otherwise
  the games split into separate tournaments.
- Moves in SAN (`Nf3`, `O-O`, `exd5`, `e8=Q`). Comments in `{braces}`, variations in `(parentheses)`,
  symbols as NAGs (`$1` = !, `$2` = ?, …) are kept. Arrows/squares as `[%cal Ge2e4]` / `[%csl Rd5]` are shown.
- For a position that does not start from the initial position, add `[SetUp "1"]` and `[FEN "…"]`.
- End the move text with the result (`1-0`, `0-1`, `1/2-1/2` or `*`).

## Example

```
[Event "Vereinsmeisterschaft 2026"]
[Site "Riegelsberg"]
[Date "2026.03.14"]
[Round "5"]
[White "Dony, Lukas"]
[Black "Muster, Max"]
[Result "1-0"]
[WhiteElo "1520"]
[BlackElo "1480"]

1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 Bd6 {Das übliche Abtauschangebot.} 5. Bg3 O-O
6. Bd3 c5 7. c3 Nc6 8. Nbd2 b6 9. Ne5 $1 Bb7 10. f4 1-0
```
