import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/session-snapshot.mjs backups/<backup-name>');
const code = `
(async () => {
  const key = process.env.WAHA_API_KEY_PLAIN || process.env.WAHA_API_KEY;
  if (!key || key.startsWith('sha512:')) throw new Error();
  const r = await fetch('http://127.0.0.1:3000/api/sessions?all=true', { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error();
  process.stdout.write(JSON.stringify(await r.json()));
})().catch(() => { process.stderr.write('Session snapshot failed'); process.exitCode = 1; });
`;
try {
  const container = JSON.parse(execFileSync('docker', ['inspect', 'waha'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
  const sessions = JSON.parse(execFileSync('docker', ['exec', 'waha', 'node', '-e', code], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  if (!Array.isArray(sessions)) throw new Error();
  const target = resolve(directory);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const write = (name, value) => writeFileSync(join(target, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  write('container.json', container);
  write('sessions.json', sessions);
  write('baseline.json', sessions.map((session) => ({ name: session.name, status: session.status, accountFingerprint: session.me?.id ? createHash('sha256').update(session.me.id).digest('hex') : null })));
  console.log('Private runtime/configuration snapshot saved. Back up session files consistently during approved cutover.');
} catch {
  console.error('Snapshot failed or destination already contains a backup; existing files were not overwritten.');
  process.exitCode = 1;
}
