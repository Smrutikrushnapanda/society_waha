import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const project = `societyos-waha-test-${randomBytes(5).toString('hex')}`;
const composeFile = fileURLToPath(new URL('./compose.test.yaml', import.meta.url));
const runtimePassword = randomBytes(24).toString('hex');
const env = {
  ...process.env,
  SOCIETYOS_TEST_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
  SOCIETYOS_TEST_API_KEY: randomBytes(24).toString('hex'),
  SOCIETYOS_TEST_PG_URL: `postgresql://waha_runtime:${runtimePassword}@postgres:5432/postgres?sslmode=disable`,
};
const args = ['compose', '--project-name', project, '--file', composeFile];

function docker(command, { input, allowFailure = false, timeout = 180000 } = {}) {
  const result = spawnSync('docker', [...args, ...command], { env, input, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) {
    let diagnostic = result.stderr || '';
    for (const value of [runtimePassword, env.SOCIETYOS_TEST_ADMIN_PASSWORD, env.SOCIETYOS_TEST_API_KEY, env.SOCIETYOS_TEST_PG_URL]) diagnostic = diagnostic.replaceAll(value, '<redacted>');
    diagnostic = diagnostic.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '<redacted-postgres-url>');
    if (diagnostic) console.error(diagnostic.slice(-2000));
    throw new Error(`Isolated Docker step failed: ${command.slice(0, 4).join(' ')} (exit ${result.status})`);
  }
  return result;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitHealthy() {
  for (let attempt = 0; attempt < 45; attempt++) {
    if (docker(['exec', '-T', 'waha', 'node', '/opt/societyos-waha/healthcheck.cjs'], { allowFailure: true, timeout: 18000 }).status === 0) return;
    await pause(1000);
  }
  throw new Error('Isolated WAHA/PostgreSQL did not become ready');
}
function node(code) { return docker(['exec', '-T', 'waha', 'node'], { input: code }).stdout; }

const sessionProbe = `
const assert = require('node:assert/strict');
(async () => {
  const r = await fetch('http://127.0.0.1:3000/api/sessions/persistence_fixture', { headers: { 'X-Api-Key': process.env.WAHA_API_KEY } });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.status, 'STOPPED');
  assert.equal(s.config.metadata.purpose, 'isolated-persistence-test');
  console.log('stopped fixture preserved');
})().catch(() => process.exitCode = 1);
`;

function archiveProbe(write) {
  return `
require('/app/node_modules/reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { PsqlStore } = require('/app/dist/core/storage/psql/PsqlStore.js');
const { parsePsql } = require('/app/dist/core/storage/psql/PsqlConnectionConfig.js');
const { WebJSPsqlAuth } = require('/app/dist/core/engines/webjs/WebJSPsqlAuth.js');
const { StreamZipper } = require('/app/dist/core/engines/webjs/StreamZipper.js');
const { RemoteAuth } = require('/app/dist/core/engines/webjs/RemoteAuth.js');
const logger = { info() {}, debug() {}, warn() {}, error() {}, child() { return this; } };
(async () => {
  process.chdir('/tmp');
  const config = parsePsql(process.env.WHATSAPP_SESSIONS_POSTGRESQL_URL);
  const store = new PsqlStore(config, 'all', 'webjs');
  let auth;
  try {
    await store.init();
    await store.init('persistence_fixture');
    auth = new WebJSPsqlAuth(store.buildSessionKnex('persistence_fixture', 'Fixture'), logger);
    await auth.init();
    const zipper = new StreamZipper();
    if (${write}) {
      await fs.mkdir('/tmp/fixture/Default/IndexedDB', { recursive: true });
      await fs.writeFile('/tmp/fixture/Default/IndexedDB/fixture', 'synthetic fixture, not WhatsApp credentials');
      await zipper.compress('/tmp/fixture', 'RemoteAuth-persistence_fixture.zip');
      await auth.save({ session: 'RemoteAuth-persistence_fixture' });
      await fs.unlink('RemoteAuth-persistence_fixture.zip');
    }
    const remote = new RemoteAuth({ clientId: 'persistence_fixture', dataPath: '/tmp/restoration-proof', store: auth, backupSyncIntervalMs: 60000, logger, zipper });
    remote.setup({ options: { puppeteer: {} } });
    await remote.beforeBrowserInitialized();
    assert.equal(await fs.readFile(remote.userDataDir + '/Default/IndexedDB/fixture', 'utf8'), 'synthetic fixture, not WhatsApp credentials');
    console.log('synthetic browser archive restored from PostgreSQL');
  } finally {
    if (auth) await auth.close();
    await store.close();
  }
})().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
`;
}

try {
  docker(['config', '--quiet']);
  console.log('PASS isolated Compose validation');
  docker(['up', '-d', 'postgres']);
  for (let i = 0; i < 30; i++) {
    if (docker(['exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres'], { allowFailure: true }).status === 0) break;
    await pause(1000);
  }
  docker(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: `
CREATE ROLE waha_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}';
CREATE DATABASE waha_all OWNER waha_runtime;
CREATE DATABASE waha_webjs_persistence_fixture OWNER waha_runtime;
REVOKE ALL ON DATABASE waha_all FROM PUBLIC;
REVOKE ALL ON DATABASE waha_webjs_persistence_fixture FROM PUBLIC;
` });
  docker(['exec', '-T', 'postgres', 'psql', '-X', '-U', 'postgres', '-v', 'waha_session=persistence_fixture'], {
    input: readFileSync(new URL('../provision-postgres.sql', import.meta.url), 'utf8'),
  });
  console.log('PASS least-privilege provisioning script reuses existing databases');
  docker(['up', '-d', 'waha']);
  await waitHealthy();
  console.log('PASS WAHA 2026.9.2 PostgreSQL readiness with NOCREATEDB runtime role');
  node(`
const assert = require('node:assert/strict');
(async () => {
  const r = await fetch('http://127.0.0.1:3000/api/sessions', { method: 'POST', headers: { 'X-Api-Key': process.env.WAHA_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'persistence_fixture', start: false, config: { metadata: { purpose: 'isolated-persistence-test' } } }) });
  assert.ok(r.ok);
})().catch(() => process.exitCode = 1);
`);
  node(sessionProbe);
  node(archiveProbe(true));
  console.log('PASS stopped session creation and synthetic WEBJS RemoteAuth archive storage');
  docker(['restart', 'waha']);
  await waitHealthy();
  node(sessionProbe);
  node(archiveProbe(false));
  console.log('PASS stopped session and synthetic archive survive container restart');
  docker(['up', '-d', '--force-recreate', '--renew-anon-volumes', 'waha']);
  await waitHealthy();
  node(sessionProbe);
  node(archiveProbe(false));
  console.log('PASS stopped session and synthetic archive survive container recreation');
  docker(['stop', 'postgres']);
  assert.notEqual(docker(['exec', '-T', 'waha', 'node', '/opt/societyos-waha/healthcheck.cjs'], { allowFailure: true }).status, 0);
  docker(['start', 'postgres']);
  await waitHealthy();
  node(sessionProbe);
  node(archiveProbe(false));
  console.log('PASS PostgreSQL outage detection, reconnection and stored archive recovery');
  assert.notEqual(docker(['exec', '-T', '-e', 'WAHA_SESSION_NAME=persistence_fixture', 'waha', 'node', '/opt/societyos-waha/verify-persistence.cjs'], { allowFailure: true }).status, 0);
  console.log('PASS acceptance verifier refuses unauthenticated fixtures');
  console.log('LIMIT: no real WhatsApp account was paired; authenticated recreation acceptance remains pending.');
} finally {
  docker(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
}
