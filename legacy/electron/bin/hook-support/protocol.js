'use strict';

const crypto = require('crypto');

const MAX_CLOCK_SKEW_MS = 30_000;
const NONCE_BYTES = 24;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const INSTALLATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sessionBinding(sessionId) {
  return sha256(Buffer.from(String(sessionId), 'utf8'));
}

function canonicalRequest({ method, path, installationId, timestamp, nonce, sessionHash, body }) {
  const bodyHash = sha256(body);
  return [
    'JICHO-HOOK-V1',
    method,
    path,
    installationId,
    String(timestamp),
    nonce,
    sessionHash,
    bodyHash
  ].join('\n');
}

function signRequest(credential, { method = 'POST', path = '/', timestamp = Date.now(), nonce, sessionHash, body }) {
  if (!credential || !Buffer.isBuffer(credential.key) || credential.key.length !== 32 || !INSTALLATION_PATTERN.test(credential.installationId)) {
    throw new TypeError('A valid Jicho hook credential is required.');
  }
  const actualNonce = nonce || crypto.randomBytes(NONCE_BYTES).toString('base64url');
  const actualSessionHash = sessionHash || sessionBinding('');
  const fields = { method, path, installationId: credential.installationId, timestamp, nonce: actualNonce, sessionHash: actualSessionHash, body };
  const signature = crypto.createHmac('sha256', credential.key).update(canonicalRequest(fields), 'utf8').digest('hex');
  return {
    'X-Jicho-Installation': credential.installationId,
    'X-Jicho-Timestamp': String(timestamp),
    'X-Jicho-Nonce': actualNonce,
    'X-Jicho-Session': actualSessionHash,
    'X-Jicho-Signature': signature
  };
}

function safeEqualHex(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !SIGNATURE_PATTERN.test(actual) || !SIGNATURE_PATTERN.test(expected)) return false;
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyRequest(credential, headers, body, now = Date.now()) {
  if (!credential || !Buffer.isBuffer(credential.key) || credential.key.length !== 32) return { ok: false, reason: 'credential-unavailable' };
  const installationId = headers.installation;
  const timestampText = headers.timestamp;
  const nonce = headers.nonce;
  const sessionHash = headers.session;
  const signature = headers.signature;
  if (!INSTALLATION_PATTERN.test(installationId || '') || installationId !== credential.installationId) return { ok: false, reason: 'installation-mismatch' };
  if (!/^(0|[1-9][0-9]{0,15})$/.test(timestampText || '')) return { ok: false, reason: 'invalid-timestamp' };
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'expired' };
  if (!NONCE_PATTERN.test(nonce || '')) return { ok: false, reason: 'invalid-nonce' };
  if (!HASH_PATTERN.test(sessionHash || '') || !SIGNATURE_PATTERN.test(signature || '')) return { ok: false, reason: 'invalid-envelope' };
  const expected = crypto.createHmac('sha256', credential.key)
    .update(canonicalRequest({ method: 'POST', path: '/', installationId, timestamp: timestampText, nonce, sessionHash, body }), 'utf8')
    .digest('hex');
  if (!safeEqualHex(signature, expected)) return { ok: false, reason: 'bad-signature' };
  return { ok: true, installationId, timestamp, nonce, sessionHash };
}

module.exports = {
  MAX_CLOCK_SKEW_MS,
  NONCE_BYTES,
  INSTALLATION_PATTERN,
  sessionBinding,
  canonicalRequest,
  signRequest,
  verifyRequest,
  safeEqualHex
};
