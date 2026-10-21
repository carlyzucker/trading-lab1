import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../core/data/http';
import type { Candidate } from '../core/data/markets';
import { addInstrument, detectGaps, discoverInstruments, ensureAccounts, ensureFx, resetAccount, scan, skipGap, type Discovery, type LiveDeps, type ScanReport } from '../core/live';
import { defaultState, makeBackup, migrateState, type AppState } from '../core/state';
import { kvGet, kvSet, storageMode } from './storage';

const deps: LiveDeps = { fetch: (u, i) => fetch(u, i), now: () => Date.now() };

export interface Lab {
  state: AppState;
  rev: number;
  busy: string | null;
  lastReport: ScanReport | null;
  discovery: Discovery | null;
  visible: boolean;
  storage: 'indexeddb' | 'memory';
  resumeInfo: string | null;
  toast: string | null;
  commit: (fn: (s: AppState) => void) => void;
  setRunning: (on: boolean) => void;
  scanNow: () => Promise<void>;
  discover: () => Promise<void>;
  choose: (c: Candidate) => Promise<void>;
  replayGap: (symbol: string) => Promise<void>;
  skip: (symbol: string) => void;
  resetAcc: (id: string) => void;
  exportBackup: () => string;
  importBackup: (json: string) => void;
  resetAll: () => void;
  notify: (msg: string) => void;
  deps: LiveDeps;
}

export function useLab(): Lab | null {
  const ref = useRef<AppState | null>(null);
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<ScanReport | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : !document.hidden);
  const [resumeInfo, setResumeInfo] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const scanning = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (ref.current) void kvSet('state', ref.current);
    }, 300);
  }, []);

  const commit = useCallback(
    (fn: (s: AppState) => void) => {
      if (!ref.current) return;
      fn(ref.current);
      setRev((r) => r + 1);
      persist();
    },
    [persist],
  );

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  // Laden
  useEffect(() => {
    (async () => {
      let s: AppState;
      try {
        const raw = await kvGet<AppState>('state');
        s = raw ? migrateState(raw) : defaultState();
        if (raw && (raw as AppState).live?.running) {
          s.live.running = true; // Nutzer wollte, dass der Bot läuft → kontrolliert fortsetzen
          const since = raw.live.lastScanAt ? Math.round((Date.now() - raw.live.lastScanAt) / 60000) : null;
          setResumeInfo(
            since !== null && since > 2
              ? `Die App war etwa ${since} Minuten nicht aktiv. In dieser Zeit wurde nichts simuliert. Lücken werden geprüft, bevor weitergerechnet wird.`
              : null,
          );
        }
      } catch {
        s = defaultState();
      }
      for (const g of detectGaps(s, Date.now())) if (!s.live.gaps.some((x) => x.symbol === g.symbol)) s.live.gaps.push(g);
      const disc = await kvGet<Discovery>('discovery');
      if (disc) setDiscovery(disc);
      ref.current = s;
      setRev((r) => r + 1);
      // Konten früh anlegen, sobald ein echter Wechselkurs verfügbar ist
      ensureFx(deps, s)
        .then(() => {
          ensureAccounts(s);
          setRev((r) => r + 1);
          void kvSet('state', s);
        })
        .catch(() => undefined);
    })();
  }, []);

  const scanNow = useCallback(async () => {
    const s = ref.current;
    if (!s || scanning.current) return;
    scanning.current = true;
    try {
      const r = await scan(deps, s);
      setLastReport(r);
    } catch (e) {
      const d = describeError(e);
      s.live.lastErrors = [{ at: Date.now(), ...d }, ...s.live.lastErrors].slice(0, 30);
    } finally {
      scanning.current = false;
      setRev((x) => x + 1);
      persist();
    }
  }, [persist]);

  // Sichtbarkeit: im Hintergrund wird NICHT simuliert
  useEffect(() => {
    const on = () => {
      const v = !document.hidden;
      setVisible(v);
      if (!v && ref.current?.live.running) {
        ref.current.live.stoppedAt = Date.now();
        void kvSet('state', ref.current);
      }
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // Scan-Takt: prüft jede Sekunde, ob der nächste 60-s-Scan fällig ist
  const running = ref.current?.live.running ?? false;
  useEffect(() => {
    if (!running || !visible) return;
    const tick = () => {
      const s = ref.current;
      if (!s?.live.running) return;
      const due = (s.live.lastScanAt ?? 0) + s.settings.scanIntervalSec * 1000;
      if (Date.now() >= due) void scanNow();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, visible, scanNow]);

  // Bildschirm wach halten, solange der Bot läuft und die App sichtbar ist
  useEffect(() => {
    if (!running || !visible) return;
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => {
      void lock?.release().catch(() => undefined);
    };
  }, [running, visible]);

  const setRunning = useCallback(
    (on: boolean) =>
      commit((s) => {
        s.live.running = on;
        if (!on) s.live.stoppedAt = Date.now();
        if (on) s.live.lastScanAt = 0;
      }),
    [commit],
  );

  const discover = useCallback(async () => {
    if (!ref.current) return;
    setBusy('Lade Bybit-Instrumentliste …');
    try {
      const d = await discoverInstruments(deps, ref.current);
      setDiscovery(d);
      void kvSet('discovery', d);
    } finally {
      setBusy(null);
    }
  }, []);

  const choose = useCallback(
    async (c: Candidate) => {
      if (!ref.current) return;
      setBusy(`Lade Handelsbedingungen für ${c.symbol} …`);
      try {
        await addInstrument(deps, ref.current, c);
        notify(`${c.symbol} wird simuliert`);
      } catch (e) {
        notify(describeError(e).message);
      } finally {
        setBusy(null);
        setRev((r) => r + 1);
        persist();
      }
    },
    [notify, persist],
  );

  const replayGap = useCallback(
    async (symbol: string) => {
      const s = ref.current;
      if (!s || scanning.current) return;
      scanning.current = true;
      setBusy('Rechne Lücke mit echten historischen Kerzen nach …');
      try {
        setLastReport(await scan(deps, s, { replay: [symbol] }));
      } finally {
        scanning.current = false;
        setBusy(null);
        setRev((r) => r + 1);
        persist();
      }
    },
    [persist],
  );

  const skip = useCallback(
    (symbol: string) => {
      try {
        commit((s) => skipGap(s, symbol, Date.now()));
      } catch (e) {
        notify((e as Error).message);
      }
    },
    [commit, notify],
  );

  const resetAcc = useCallback(
    (id: string) =>
      commit((s) => {
        if (!s.fx) throw new Error('Kein Wechselkurs');
        resetAccount(s, id);
      }),
    [commit],
  );

  const exportBackup = useCallback(() => JSON.stringify(makeBackup(ref.current!), null, 1), []);

  const importBackup = useCallback(
    (json: string) => {
      const s = migrateState(JSON.parse(json));
      ref.current = s;
      setRev((r) => r + 1);
      persist();
    },
    [persist],
  );

  const resetAll = useCallback(() => {
    const s = defaultState();
    ref.current = s;
    setDiscovery(null);
    setRev((r) => r + 1);
    persist();
    ensureFx(deps, s)
      .then(() => {
        ensureAccounts(s);
        setRev((r) => r + 1);
        persist();
      })
      .catch(() => undefined);
  }, [persist]);

  if (!ref.current) return null;
  return {
    state: ref.current,
    rev,
    busy,
    lastReport,
    discovery,
    visible,
    storage: storageMode,
    resumeInfo,
    toast,
    commit,
    setRunning,
    scanNow,
    discover,
    choose,
    replayGap,
    skip,
    resetAcc,
    exportBackup,
    importBackup,
    resetAll,
    notify,
    deps,
  };
}
