// Web Worker: rechnet Backtests ausserhalb der Oberfläche, damit die App flüssig bleibt.
import { runJob, type BacktestJob } from '../core/jobs';

self.onmessage = (e: MessageEvent<BacktestJob>) => {
  try {
    (self as unknown as Worker).postMessage({ ok: true, result: runJob(e.data) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
