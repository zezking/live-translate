// Live end-to-end probe for the single-device conversation pipeline.
// Usage (dev server running on :4000):
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/duo-e2e-probe.mjs <wavA> <langA> <wavB> <langB>
// Example:
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/duo-e2e-probe.mjs /tmp/en.wav en /tmp/ko.wav ko
// WAVs must be 16 kHz 16-bit mono (e.g. `say -v Samantha -o /tmp/en.aiff "…"` then
// `afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/en.aiff /tmp/en.wav`).
import { readFileSync } from 'node:fs';

const [, , wavAPath, langA, wavBPath, langB] = process.argv;
if (!wavAPath || !langA || !wavBPath || !langB) {
  console.error('usage: node duo-e2e-probe.mjs <wavA> <langA> <wavB> <langB>');
  process.exit(2);
}

const deltas = [];
const ws = new WebSocket('wss://localhost:4000/ws/conversation');
const log = (...a) => console.log(`[${(performance.now() / 1000).toFixed(1)}s]`, ...a);

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'delta') { deltas.push(m); log(`delta ${m.field} ${m.lang} ${JSON.stringify(m.text)}`); }
  else log(JSON.stringify(m));
};
ws.onclose = (ev) => log(`closed ${ev.code} ${ev.reason}`);

const pcmOf = (p) => readFileSync(p).subarray(44);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function speak(wavPath, lang) {
  const pcm = pcmOf(wavPath);
  ws.send(JSON.stringify({ type: 'direction', from: lang }));
  for (let off = 0; off < pcm.length; off += 3200) {
    ws.send(pcm.subarray(off, off + 3200));
    await sleep(100);
  }
  ws.send(JSON.stringify({ type: 'direction', from: null }));
  await sleep(8000); // let ASR + translation catch up
}

await new Promise((res) => { ws.onopen = res; });
ws.send(JSON.stringify({ type: 'start', languages: [langA, langB], voiceOver: false, voiceClone: false }));
await sleep(4000); // sessions connect → status ready

await speak(wavAPath, langA);
await speak(wavBPath, langB);

const has = (field, lang) => deltas.some((d) => d.field === field && d.lang === lang);
const checks = [
  [`${langA} original`, has('original', langA)],
  [`${langA}→${langB} translation`, has('translation', langB)],
  [`${langB} original`, has('original', langB)],
  [`${langB}→${langA} translation`, has('translation', langA)],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'PASS' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
