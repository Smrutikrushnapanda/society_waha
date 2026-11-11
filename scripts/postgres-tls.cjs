'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');

const PARSER_PATH = '/app/dist/core/storage/psql/PsqlConnectionConfig.js';
const PARSER_HASH = '743267c67aec6d1eaea1ea159e1a6f69993028b75aadc39f965139e767590cbd';

function secureConfig(connectionUrl, allowLocalPlaintext = false) {
  let url;
  try { url = new URL(connectionUrl); } catch { throw new Error('Invalid WAHA PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password || !url.pathname.slice(1)) {
    throw new Error('Incomplete WAHA PostgreSQL URL');
  }
  if (url.hostname.includes('-pooler.')) throw new Error('WAHA requires the direct PostgreSQL endpoint');
  for (const key of url.searchParams.keys()) {
    if (!['sslmode', 'application_name'].includes(key)) throw new Error('Unsupported WAHA PostgreSQL connection option');
  }
  const sslmode = url.searchParams.get('sslmode');
  const local = ['localhost', '127.0.0.1', 'postgres', 'waha-postgres-test'].includes(url.hostname);
  if (sslmode === 'disable' && !(allowLocalPlaintext && local)) throw new Error('PostgreSQL TLS cannot be disabled for this endpoint');
  if (sslmode && !['require', 'verify-full', 'disable'].includes(sslmode)) throw new Error('Unsupported PostgreSQL TLS mode');
  try {
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      ssl: sslmode === 'disable' ? false : { rejectUnauthorized: true, servername: url.hostname },
      connectionTimeoutMillis: 10000,
      ...(url.searchParams.has('application_name') ? { application_name: url.searchParams.get('application_name') } : {}),
    };
  } catch { throw new Error('Invalid PostgreSQL URL encoding'); }
}

function stringifyConfig(config) {
  const url = new URL('postgresql://localhost');
  url.hostname = config.host;
  url.port = String(config.port || 5432);
  url.username = encodeURIComponent(config.user);
  url.password = encodeURIComponent(config.password);
  url.pathname = '/' + encodeURIComponent(config.database);
  url.searchParams.set('sslmode', config.ssl === false ? 'disable' : 'verify-full');
  return url.toString();
}

function validateEnv(env = process.env) {
  if (!env.WHATSAPP_SESSIONS_POSTGRESQL_URL) throw new Error('WAHA PostgreSQL persistence URL is required');
  if ((env.WHATSAPP_DEFAULT_ENGINE || 'WEBJS') !== 'WEBJS') throw new Error('This audited WAHA deployment requires WEBJS');
  if (env.WHATSAPP_SESSIONS_MONGO_URL) throw new Error('Remove conflicting MongoDB session configuration before PostgreSQL cutover');
  const mediaStorage = (env.WAHA_MEDIA_STORAGE || 'LOCAL').trim().toUpperCase();
  if (!['LOCAL', 'POSTGRESQL'].includes(mediaStorage)) {
    throw new Error('Unsupported WAHA media storage; only LOCAL or POSTGRESQL is audited');
  }
  const allowLocal = env.SOCIETYOS_WAHA_ALLOW_LOCAL_PG_PLAINTEXT === 'true';
  secureConfig(env.WHATSAPP_SESSIONS_POSTGRESQL_URL, allowLocal);
  if (mediaStorage === 'POSTGRESQL') {
    if (!env.WAHA_MEDIA_POSTGRESQL_URL) {
      throw new Error('WAHA_MEDIA_POSTGRESQL_URL is required when WAHA_MEDIA_STORAGE=POSTGRESQL');
    }
    secureConfig(env.WAHA_MEDIA_POSTGRESQL_URL, allowLocal);
  }
  return { allowLocal, mediaStorage };
}

function install() {
  const { allowLocal } = validateEnv(process.env);
  const checksum = createHash('sha256').update(fs.readFileSync(PARSER_PATH)).digest('hex');
  if (checksum !== PARSER_HASH) throw new Error('WAHA PostgreSQL parser changed; re-audit TLS compatibility before deployment');
  const parser = require(PARSER_PATH);
  parser.parsePsql = (url) => secureConfig(url, allowLocal);
  parser.stringifyPsql = stringifyConfig;
  parser.societyosTlsVerified = true;
}

module.exports = { secureConfig, stringifyConfig, validateEnv, install };
if (process.env.SOCIETYOS_WAHA_POSTGRES_GUARD === 'true') install();
