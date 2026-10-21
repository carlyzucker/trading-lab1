// Prüft alle öffentlichen Datenquellen von diesem Rechner aus:  npm run probe
import { probeSources } from '../src/core/data/probe';
import { DEFAULT_ENDPOINTS } from '../src/core/data/http';

const res = await probeSources((u, i) => fetch(u, i), { ...DEFAULT_ENDPOINTS, proxy: process.env.PROXY_URL });
for (const r of res) console.log(`${r.ok ? 'OK  ' : 'FEHL'} ${r.name.padEnd(34)} ${r.detail}${r.hint ? ' → ' + r.hint : ''}`);
process.exit(res.every((r) => r.ok) ? 0 : 1);
