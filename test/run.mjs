// Bundles a test (TypeScript, with the app's own modules) with esbuild and runs it in Node, which has WebSocket and WebCrypto.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const name = process.argv[2] ?? 'interop';
const dir = mkdtempSync(join(tmpdir(), 'arnav-web-test-'));
const out = join(dir, `${name}.mjs`);
await build({ entryPoints: [`test/${name}.ts`], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: out, logLevel: 'warning' });
const r = spawnSync(process.execPath, [out], { stdio: 'inherit', env: { ...process.env, QA_DIR: process.env.QA_DIR ?? join(dir, 'qa') } });
process.exit(r.status ?? 1);
