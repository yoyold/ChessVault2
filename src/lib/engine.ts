// Dünne UCI-Schicht über Stockfish (WASM, läuft komplett im Browser als Web Worker).
export interface PV {
  depth: number;
  cp?: number; // aus Sicht von Weiß
  mate?: number; // aus Sicht von Weiß (positiv = Weiß setzt matt)
  pv: string[]; // UCI-Züge
}

export interface AnalyzeOpts { depth?: number; movetime?: number; multipv?: number }

export class Job {
  cancelled = false;
  started = false;
  constructor(private engine: Engine) {}
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.started) this.engine.post('stop');
  }
}

export class Engine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private listener: ((line: string) => void) | null = null;
  failed = false;

  post(cmd: string) { this.worker?.postMessage(cmd); }

  private init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      try {
        const url = new URL('engine/stockfish-19-lite-single.js', document.baseURI).toString();
        this.worker = new Worker(url);
      } catch (e) { this.failed = true; reject(e); return; }
      this.worker.onerror = e => { this.failed = true; reject(new Error('Engine konnte nicht geladen werden: ' + e.message)); };
      this.worker.onmessage = ev => {
        const line = typeof ev.data === 'string' ? ev.data : '';
        if (line === 'uciok') this.post('isready');
        else if (line === 'readyok') resolve();
        this.listener?.(line);
      };
      this.post('uci');
    });
    return this.ready;
  }

  /** Startet eine Analyse. Jobs laufen strikt nacheinander; über job.cancel() abbrechbar. */
  analyze(fen: string, opts: AnalyzeOpts, onUpdate?: (lines: PV[]) => void): { job: Job; done: Promise<PV[]> } {
    const job = new Job(this);
    const done = this.chain.then(() => this.exec(fen, opts, job, onUpdate));
    this.chain = done.catch(() => {});
    return { job, done };
  }

  private async exec(fen: string, opts: AnalyzeOpts, job: Job, onUpdate?: (lines: PV[]) => void): Promise<PV[]> {
    if (job.cancelled) return [];
    await this.init();
    if (job.cancelled) return [];
    const black = fen.split(' ')[1] === 'b';
    const sign = black ? -1 : 1;
    const multipv = opts.multipv ?? 1;
    let lines: PV[] = [];
    return new Promise<PV[]>(resolve => {
      this.listener = line => {
        if (line.startsWith('info ') && line.includes(' score ')) {
          if (line.includes('upperbound') || line.includes('lowerbound')) return;
          const depth = +(line.match(/ depth (\d+)/)?.[1] ?? 0);
          const idx = +(line.match(/ multipv (\d+)/)?.[1] ?? 1) - 1;
          const cp = line.match(/ score cp (-?\d+)/);
          const mate = line.match(/ score mate (-?\d+)/);
          const pv = line.match(/ pv (.+)$/)?.[1].trim().split(/\s+/) ?? [];
          const entry: PV = { depth, pv };
          if (cp) entry.cp = sign * +cp[1];
          if (mate) entry.mate = +mate[1] === 0 ? (black ? 1 : -1) * 0.5 : sign * +mate[1];
          if (idx === 0 && lines[0] && depth > lines[0].depth) lines = lines.filter(l => l.depth >= depth - 1);
          lines[idx] = entry;
          if (!job.cancelled) onUpdate?.(lines.filter(Boolean));
        } else if (line.startsWith('bestmove')) {
          this.listener = null;
          resolve(lines.filter(Boolean));
        }
      };
      job.started = true;
      this.post(`setoption name MultiPV value ${multipv}`);
      this.post(`position fen ${fen}`);
      this.post(opts.movetime ? `go movetime ${opts.movetime}` : `go depth ${opts.depth ?? 16}`);
      if (job.cancelled) this.post('stop');
    });
  }
}

export const engine = new Engine();

export function formatScore(pv: { cp?: number; mate?: number } | undefined): string {
  if (!pv) return '–';
  if (pv.mate !== undefined) {
    if (Math.abs(pv.mate) < 1) return pv.mate > 0 ? '1-0' : '0-1';
    return (pv.mate > 0 ? '+' : '−') + 'M' + Math.abs(pv.mate);
  }
  const v = (pv.cp ?? 0) / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}

/** Gewinnwahrscheinlichkeit für Weiß in Prozent (Lichess-Formel). */
export function winPct(pv: { cp?: number; mate?: number } | undefined): number {
  if (!pv) return 50;
  if (pv.mate !== undefined) return pv.mate > 0 ? 100 : 0;
  const cp = Math.max(-1500, Math.min(1500, pv.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
