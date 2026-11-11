'use strict';

const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const fromWaha = createRequire('/app/package.json');

async function verify() {
  const name = process.env.WAHA_SESSION_NAME;
  if (!name || !/^[-\w]+$/.test(name)) throw new Error('Configure the existing WAHA session name');
  const key = process.env.WAHA_API_KEY_PLAIN || process.env.WAHA_API_KEY;
  if (!key || key.startsWith('sha512:')) throw new Error('Configure a usable API credential');
  const response = await fetch('http://127.0.0.1:3000/api/sessions/' + encodeURIComponent(name), {
    headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Session status cannot be verified');
  const session = await response.json();
  if (session.status !== 'WORKING' || !session.me?.id) throw new Error('Session is not authenticated and WORKING');
  const accountFingerprint = createHash('sha256').update(session.me.id).digest('hex');
  const expected = process.env.SOCIETYOS_EXPECTED_ACCOUNT_SHA256;
  if (expected && expected !== accountFingerprint) throw new Error('Authenticated account changed');
  const parser = require('/app/dist/core/storage/psql/PsqlConnectionConfig.js');
  if (!parser.societyosTlsVerified) throw new Error('PostgreSQL TLS guard is not installed');
  const config = parser.parsePsql(process.env.WHATSAPP_SESSIONS_POSTGRESQL_URL);
  const namespace = process.env.WAHA_SESSION_NAMESPACE || 'webjs';
  const database = `waha_${namespace}_${name.toLowerCase().replace(/[^a-z0-9-]/g, '_')}`;
  const { Client } = fromWaha('pg');
  const client = new Client({ ...config, database, statement_timeout: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query('SELECT octet_length(content) AS bytes, created_at FROM files WHERE fullpath = $1', [`RemoteAuth-${name}.zip`]);
    await client.query('ROLLBACK');
    if (!result.rows[0] || Number(result.rows[0].bytes) <= 0) throw new Error('Remote authentication archive is not saved yet');
    console.log(JSON.stringify({ session: name, status: session.status, accountFingerprint, authArchiveSaved: true, archiveTimestamp: result.rows[0].created_at }));
  } finally { await client.end(); }
}

verify().catch(() => { console.error('Authenticated PostgreSQL session persistence is not verified'); process.exitCode = 1; });
