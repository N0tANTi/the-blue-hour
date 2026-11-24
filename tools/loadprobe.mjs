// Load only: marks and long tasks, muted headless (no fps run).
import { launch, startPreview, watch, PROBE_INIT } from '../scripts/lib.mjs';
const server = await startPreview('dist');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: Number(process.argv[2] ?? 1280), height: Number(process.argv[3] ?? 720) } });
await page.addInitScript(PROBE_INIT);
const w = watch(page, server.url);
await page.goto(`${server.url}`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => ({ marks: window.__game.state().marks, long: window.__probe.longtasks.filter((l) => l.ms > 150), blocks: window.__probe.blocks })), null, 0));
console.log('errors', w.errors.length, w.errors.slice(0, 3));
await browser.close();
server.stop();
