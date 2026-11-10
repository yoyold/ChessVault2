// Baut src/lib/openings.json aus dem CC0-Datensatz lichess-org/chess-openings (a.tsv … e.tsv).
// Aufruf: node scripts/build-openings.mjs <ordner-mit-tsv>
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const out = {};
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const lines = fs.readFileSync(path.join(dir, f + '.tsv'), 'utf8').split('\n').slice(1);
  for (const l of lines) {
    const [eco, name, pgn] = l.split('\t');
    if (!pgn) continue;
    const key = pgn.replace(/\d+\.+\s*/g, '').replace(/[+#]/g, '').trim();
    out[key] = [eco, name];
  }
}
fs.writeFileSync('src/lib/openings.json', JSON.stringify(out));
console.log(Object.keys(out).length, 'Eröffnungen');
