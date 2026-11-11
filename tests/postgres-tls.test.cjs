'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { secureConfig, stringifyConfig, validateEnv } = require('../scripts/postgres-tls.cjs');

test('Neon connections verify certificates and hostname', () => {
  const config = secureConfig('postgresql://waha:fixture@example.neon.tech:5432/postgres?sslmode=require');
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, servername: 'example.neon.tech' });
  assert.equal(config.connectionTimeoutMillis, 10000);
});

test('URL-encoded credentials survive session database URL rewriting', () => {
  const config = secureConfig('postgresql://waha:p%40ss%3Aword%25%2F@example.neon.tech/postgres?sslmode=verify-full');
  assert.equal(config.password, 'p@ss:word%/');
  config.database = 'waha_webjs_fixture';
  const next = secureConfig(stringifyConfig(config));
  assert.equal(next.password, config.password);
  assert.equal(next.database, config.database);
  assert.equal(next.ssl.rejectUnauthorized, true);
});

test('pooled, remote plaintext and misleading TLS settings fail closed', () => {
  for (const url of [
    'postgresql://waha:fixture@ep-example-pooler.neon.tech/postgres?sslmode=require',
    'postgresql://waha:fixture@example.neon.tech/postgres?sslmode=disable',
    'postgresql://waha:fixture@example.neon.tech/postgres?sslmode=prefer',
    'postgresql://waha:fixture@example.neon.tech/postgres?sslmode=require&sslrootcert=ignored',
  ]) assert.throws(() => secureConfig(url, true));
});

test('plaintext is available only for an explicitly approved local test endpoint', () => {
  const url = 'postgresql://waha:fixture@postgres/postgres?sslmode=disable';
  assert.throws(() => secureConfig(url));
  assert.equal(secureConfig(url, true).ssl, false);
  assert.throws(() => secureConfig('postgresql://waha:fixture@public.example/postgres?sslmode=disable', true));
});

test('invalid configuration errors never echo credentials', () => {
  for (const value of ['not-a-url-with-private-secret', 'postgresql://waha:private-secret@example/postgres?sslmode=invalid']) {
    assert.throws(() => secureConfig(value), (error) => !error.message.includes('private-secret'));
  }
});

test('media storage permits LOCAL or verified POSTGRESQL and rejects unsupported modes', () => {
  const validDirect = 'postgresql://waha_runtime:fixture@example.neon.tech:5432/postgres?sslmode=verify-full';
  assert.equal(validateEnv({ WHATSAPP_SESSIONS_POSTGRESQL_URL: validDirect }).mediaStorage, 'LOCAL');
  assert.equal(
    validateEnv({
      WHATSAPP_SESSIONS_POSTGRESQL_URL: validDirect,
      WAHA_MEDIA_STORAGE: 'POSTGRESQL',
      WAHA_MEDIA_POSTGRESQL_URL: validDirect,
    }).mediaStorage,
    'POSTGRESQL',
  );
  assert.throws(() => validateEnv({ WHATSAPP_SESSIONS_POSTGRESQL_URL: validDirect, WAHA_MEDIA_STORAGE: 'POSTGRESQL' }));
  assert.throws(() => validateEnv({
    WHATSAPP_SESSIONS_POSTGRESQL_URL: validDirect,
    WAHA_MEDIA_STORAGE: 'POSTGRESQL',
    WAHA_MEDIA_POSTGRESQL_URL: 'postgresql://waha:fixture@ep-example-pooler.neon.tech:5432/postgres?sslmode=verify-full',
  }));
  assert.throws(() => validateEnv({ WHATSAPP_SESSIONS_POSTGRESQL_URL: validDirect, WAHA_MEDIA_STORAGE: 'S3' }));
});
