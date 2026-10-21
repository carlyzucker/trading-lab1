import { runJob, type BacktestJob, type JobResult } from '../core/jobs';

declare const __WORKER_SRC__: string;

export let lastJobRunner: 'web-worker' | 'hauptthread' = 'web-worker';

/** Startet den Backtest im Web Worker; falls der Browser das verbietet, im Hauptthread. */
export function runJobAsync(job: BacktestJob): Promise<JobResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    try {
      const url = URL.createObjectURL(new Blob([__WORKER_SRC__], { type: 'text/javascript' }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
    } catch {
      worker = null;
    }
    if (!worker) {
      lastJobRunner = 'hauptthread';
      setTimeout(() => {
        try {
          resolve(runJob(job));
        } catch (e) {
          reject(e);
        }
      }, 30);
      return;
    }
    lastJobRunner = 'web-worker';
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: JobResult; error?: string }>) => {
      worker!.terminate();
      if (e.data.ok) resolve(e.data.result!);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker!.terminate();
      lastJobRunner = 'hauptthread';
      try {
        resolve(runJob(job));
      } catch (err) {
        reject(err ?? e);
      }
    };
    worker.postMessage(job);
  });
}
