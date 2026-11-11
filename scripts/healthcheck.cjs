'use strict';

const { createRequire } = require('node:module');
const fromWaha = createRequire('/app/package.json');

async function verifyPostgres(Client, parser, url) {
  const client = new Client({ ...parser.parsePsql(url), statement_timeout: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query('SELECT 1');
    await client.query('ROLLBACK');
  } finally { await client.end(); }
}

async function check() {
  const key = process.env.WAHA_API_KEY_PLAIN || process.env.WAHA_API_KEY;
  if (!key || key.startsWith('sha512:')) throw new Error('WAHA health-check credential is unavailable');
  const port = process.env.PORT || process.env.WHATSAPP_API_PORT || '3000';
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok || (await response.json()).status !== 'ok') throw new Error('WAHA health check failed');
  const sessionsUrl = process.env.WHATSAPP_SESSIONS_POSTGRESQL_URL;
  const mediaPostgres = (process.env.WAHA_MEDIA_STORAGE || 'LOCAL').trim().toUpperCase() === 'POSTGRESQL';
  const mediaUrl = process.env.WAHA_MEDIA_POSTGRESQL_URL;
  if (!sessionsUrl && !mediaPostgres) return;
  const parser = require('/app/dist/core/storage/psql/PsqlConnectionConfig.js');
  if (!parser.societyosTlsVerified) throw new Error('WAHA PostgreSQL TLS guard is not installed');
  const { Client } = fromWaha('pg');
  if (sessionsUrl) await verifyPostgres(Client, parser, sessionsUrl);
  if (mediaPostgres && mediaUrl && mediaUrl !== sessionsUrl) await verifyPostgres(Client, parser, mediaUrl);
}

module.exports = { check };
if (require.main === module) check().catch(() => { console.error('WAHA or PostgreSQL readiness check failed'); process.exitCode = 1; });
