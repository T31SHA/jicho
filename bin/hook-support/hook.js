#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');
const { CredentialManager } = require('./credentials');
const { signRequest, sessionBinding } = require('./protocol');

const MAX_BODY_BYTES = 1024 * 1024;
const HOOK_TIMEOUT_MS = 118_000;

function parseHookInput(body) {
  try {
    const input = JSON.parse(body.toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.session_id !== 'string') return null;
    return input;
  } catch (_) { return null; }
}

function forwardHook(body, options = {}) {
  const input = parseHookInput(body);
  if (!input || body.length > (options.maxBodyBytes || MAX_BODY_BYTES)) return Promise.resolve(Buffer.alloc(0));
  const manager = options.credentialManager || new CredentialManager(options.credentialOptions);
  let credential;
  try { credential = manager.getCredential(); }
  catch (_) { return Promise.resolve(Buffer.alloc(0)); }
  if (!credential) return Promise.resolve(Buffer.alloc(0));

  const timestamp = String(options.timestamp === undefined ? Date.now() : options.timestamp);
  const nonce = options.nonce || crypto.randomBytes(24).toString('base64url');
  const headers = {
    ...signRequest(credential, {
      method: 'POST', path: '/', timestamp, nonce,
      sessionHash: sessionBinding(input.session_id), body
    }),
    'Content-Type': 'application/json',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  };
  const port = Number(options.port || process.env.JICHO_PORT || 47821);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value = Buffer.alloc(0)) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers, timeout: HOOK_TIMEOUT_MS }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) { request.destroy(); finish(); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return finish();
        const result = Buffer.concat(chunks);
        if (result.length === 0) return finish(result);
        try {
          const parsed = JSON.parse(result.toString('utf8'));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return finish();
        } catch (_) { return finish(); }
        finish(result);
      });
      response.on('error', () => finish());
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => finish());
    request.end(body);
  });
}

function readStdin(maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        process.stdin.pause();
        reject(new Error('input-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', () => reject(new Error('input-unavailable')));
  });
}

async function main() {
  try {
    const input = await readStdin();
    const response = await forwardHook(input);
    if (response.length) process.stdout.write(response);
  } catch (_) {
    // An unavailable or invalid Jicho hook leaves Claude Code's native flow in place.
  }
}

if (require.main === module) main();

module.exports = { MAX_BODY_BYTES, parseHookInput, forwardHook };
