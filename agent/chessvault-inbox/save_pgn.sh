#!/usr/bin/env bash
# Saves one or more chess games (PGN) into the ChessVault2 inbox.
#
# Usage:  save_pgn.sh <file.pgn> [label]
#         some-command | save_pgn.sh - [label]
#
# Needs two environment variables:
#   CHESSVAULT_REPO   the data repository, e.g. "yourname/chessvault-data"
#   CHESSVAULT_TOKEN  a fine-grained GitHub token for that repository with "Contents: Read and write"
#
# The file is committed to inbox/ on the repository's default branch. ChessVault2 imports it on its next
# sync (duplicates are skipped), tags the games "Eingang" and removes the file again.
set -euo pipefail

: "${CHESSVAULT_REPO:?set CHESSVAULT_REPO, e.g. yourname/chessvault-data}"
: "${CHESSVAULT_TOKEN:?set CHESSVAULT_TOKEN (GitHub token with Contents: Read and write)}"
api="${CHESSVAULT_API:-https://api.github.com}"

src="${1:?usage: save_pgn.sh <file.pgn|-> [label]}"
label="${2:-game}"

if [ "$src" = "-" ]; then pgn="$(cat)"; else pgn="$(cat -- "$src")"; fi
if ! printf '%s' "$pgn" | grep -Eq '^\[[A-Za-z]+ "|[0-9]+\. *[a-hKQRBNO]'; then
  echo "error: input does not look like PGN" >&2
  exit 1
fi

# file name: timestamp + process id + a safe version of the label
safe="$(printf '%s' "$label" | tr -c 'A-Za-z0-9._-' '-' | tr -s '-' | cut -c1-60)"
path="inbox/$(date -u +%Y%m%d-%H%M%S)-$$-${safe:-game}.pgn"
content="$(printf '%s\n' "$pgn" | base64 | tr -d '\n')"

status="$(curl -sS -o /tmp/chessvault-save.$$ -w '%{http_code}' -X PUT \
  -H "Authorization: Bearer $CHESSVAULT_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$api/repos/$CHESSVAULT_REPO/contents/$path" \
  -d "{\"message\":\"inbox: $safe\",\"content\":\"$content\"}")"
body="$(cat /tmp/chessvault-save.$$ 2>/dev/null || true)"; rm -f /tmp/chessvault-save.$$

case "$status" in
  200|201) echo "saved $path – ChessVault2 imports it on its next sync" ;;
  401) echo "error: token invalid or expired (401)" >&2; exit 1 ;;
  403) echo "error: token lacks 'Contents: Read and write' on $CHESSVAULT_REPO (403)" >&2; exit 1 ;;
  404) echo "error: repository $CHESSVAULT_REPO not found or not accessible with this token (404)" >&2; exit 1 ;;
  *) echo "error: GitHub answered $status: $body" >&2; exit 1 ;;
esac
