import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [file, name, confirmation] = process.argv.slice(2);
if (!file || !name || confirmation !== '--stopped-only') throw new Error('Usage: node scripts/restore-stopped-config.mjs backups/<backup>/sessions.json <session-name> --stopped-only');
try {
  const sessions = JSON.parse(readFileSync(file, 'utf8'));
  const saved = sessions.find((session) => session.name === name);
  if (!saved) throw new Error();
  const code = `
const fs = require('node:fs');
(async () => {
  const body = JSON.parse(fs.readFileSync(0, 'utf8'));
  const key = process.env.WAHA_API_KEY_PLAIN || process.env.WAHA_API_KEY;
  if (!key || key.startsWith('sha512:') || body.start !== false) throw new Error();
  const headers = { 'X-Api-Key': key, 'Content-Type': 'application/json' };
  const existing = await fetch('http://127.0.0.1:3000/api/sessions/' + encodeURIComponent(body.name), { headers, signal: AbortSignal.timeout(10000) });
  if (existing.status !== 404) throw new Error();
  const response = await fetch('http://127.0.0.1:3000/api/sessions', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error();
})().catch(() => { process.stderr.write('Stopped configuration restore failed or session already exists'); process.exitCode = 1; });
`;
  execFileSync('docker', ['exec', '-i', 'waha', 'node', '-e', code], {
    input: JSON.stringify({ name: saved.name, config: saved.config || {}, start: false }),
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log('Existing session name/configuration copied in STOPPED state. Authentication has not been imported or started.');
} catch {
  console.error('Stopped configuration restore failed; no logout, delete or automatic pairing was requested.');
  process.exitCode = 1;
}
