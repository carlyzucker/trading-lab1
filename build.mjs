// Baut die App als EINE selbständige HTML-Datei (einfach zu hosten, auch vom Handy aus).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const common = { bundle: true, minify: true, target: ['es2020', 'chrome90'], legalComments: 'none', write: false, logLevel: 'warning' };

const worker = await build({ ...common, entryPoints: ['src/ui/worker.ts'], format: 'iife' });
const workerSrc = worker.outputFiles[0].text;

const app = await build({
  ...common,
  entryPoints: ['src/ui/main.tsx'],
  format: 'iife',
  jsx: 'automatic',
  define: { __WORKER_SRC__: JSON.stringify(workerSrc), 'process.env.NODE_ENV': '"production"' },
});
const js = app.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/ui/styles.css', 'utf8');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600;700&display=swap">';
const body = `<div id="root"></div><script>${js}</script>`;

mkdirSync('dist', { recursive: true });
writeFileSync(
  'dist/index.html',
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b6964"><meta name="mobile-web-app-capable" content="yes"><title>Trading Strategy Lab</title>${fonts}<style>${css}</style></head><body>${body}</body></html>`,
);
// Variante für die Claude-Artefakt-Vorschau (Seitengerüst wird dort automatisch ergänzt)
writeFileSync('dist/artifact.html', `<title>Trading Strategy Lab</title><meta name="claude:viewport-fit-sides" content="cover">${fonts}<style>${css}</style>${body}`);
console.log(`dist/index.html ${(readFileSync('dist/index.html').length / 1024).toFixed(0)} KB (Worker ${(workerSrc.length / 1024).toFixed(0)} KB)`);
