'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const QRCode = require('qrcode');
const { EventEmitter } = require('events');

const NTFY = 'https://ntfy.sh';
const CONFIG_NAME = 'phone.json';

function newConfig() {
  const topic = crypto.randomBytes(16).toString('hex');
  return {
    topic,
    replyTopic: topic + '-reply',
    secret: crypto.randomBytes(32).toString('hex'),
    enabled: false,
    contentFree: false,
    pairingDismissed: false
  };
}

function isValidConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  if (!/^[a-f0-9]{32}$/i.test(config.topic || '') || !/^[a-f0-9]{64}$/i.test(config.secret || '')) return false;
  if (config.replyTopic !== undefined && config.replyTopic !== config.topic + '-reply') return false;
  return ['enabled', 'contentFree', 'pairingDismissed'].every((key) => config[key] === undefined || typeof config[key] === 'boolean');
}

function macFor(secret, id, decision) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(id + ':' + decision).digest('hex');
}

function verifyMac(secret, id, decision, supplied) {
  if (!/^[a-f0-9]{64}$/i.test(supplied || '')) return false;
  const expected = Buffer.from(macFor(secret, id, decision), 'hex');
  const actual = Buffer.from(supplied, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function redact(input) {
  return String(input || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, '[REDACTED]')
    .replace(/(["']?[A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|passwd|credential|authorization|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;}]+)/gi, '$1[REDACTED]')
    .replace(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=\s*).+$/gm, '$1[REDACTED]');
}

function truncate(input, length = 120) {
  const chars = Array.from(input);
  return chars.length <= length ? input : chars.slice(0, length - 1).join('') + '…';
}

function truncateMiddle(input, length = 120) {
  const chars = Array.from(String(input));
  if (chars.length <= length) return { text: chars.join(''), truncated: false };
  const ellipsis = ' … ';
  const remaining = Math.max(0, length - Array.from(ellipsis).length);
  const headLength = Math.ceil(remaining / 2);
  const tailLength = remaining - headLength;
  return {
    text: chars.slice(0, headLength).join('') + ellipsis + (tailLength ? chars.slice(-tailLength).join('') : ''),
    truncated: true
  };
}

function commandText(item) {
  if (item.input && Object.prototype.hasOwnProperty.call(item.input, 'command')) return item.input.command;
  return JSON.stringify(item.input || {});
}

function ntfyBaseUrl(value = process.env.JICHO_NTFY_URL) {
  if (!value) return NTFY;
  let parsed;
  try { parsed = new URL(value); }
  catch (_) { throw new Error('JICHO_NTFY_URL must be an absolute HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('JICHO_NTFY_URL must be an HTTP or HTTPS base URL without credentials, query, or fragment.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function ntfyPairingUrl(baseUrl, topic) {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, '');
  return 'ntfy://' + parsed.host + basePath + '/' + topic;
}

function phonePreview(item, contentFree, maxLength = 120) {
  const folder = String(item.cwd || 'session').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'session';
  const safeText = redact(folder + ' · ' + (item.tool || 'Tool') + ': ' + commandText(item));
  const preview = truncateMiddle(safeText, maxLength);
  const riskFlagged = Array.isArray(item.riskFlags) && item.riskFlags.length > 0;
  const allow = !contentFree && !preview.truncated && !riskFlagged;
  let message = preview.text;
  if (contentFree || riskFlagged) message = 'Review on desktop';
  else if (preview.truncated) message += ' · Review on desktop';
  return { message, allow, truncated: preview.truncated, riskFlagged, contentFree: Boolean(contentFree) };
}

function phoneMessage(item, contentFree) {
  return phonePreview(item, contentFree).message;
}

function action(topic, label, id, decision, secret, baseUrl = NTFY) {
  return {
    action: 'http',
    label,
    url: baseUrl + '/' + topic,
    method: 'POST',
    body: id + ':' + decision + ':' + macFor(secret, id, decision),
    clear: true
  };
}

function notificationFor(item, config, baseUrl = NTFY) {
  const preview = phonePreview(item, config.contentFree);
  const actions = [];
  if (preview.allow) actions.push(action(config.replyTopic, 'Approve', item.id, 'allow', config.secret, baseUrl));
  actions.push(action(config.replyTopic, 'Deny', item.id, 'deny', config.secret, baseUrl));
  return { topic: config.topic, title: 'Jicho approval needed', message: preview.message, priority: 4, actions };
}

function transportFor(url) {
  return new URL(url).protocol === 'https:' ? https : http;
}

class PhoneBridge extends EventEmitter {
  constructor(core, userDataDir) {
    super();
    this.core = core;
    this.directory = userDataDir;
    try { this.ntfyBaseUrl = ntfyBaseUrl(); }
    catch (error) { this.ntfyBaseUrl = ''; this.ntfyError = error.message; }
    this.configPath = path.join(userDataDir, CONFIG_NAME);
    fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
    this.isFirstRun = !fs.existsSync(this.configPath);
    this.storageBlocked = false;
    this.configError = '';
    if (this.isFirstRun) this.config = newConfig();
    else {
      try { this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); }
      catch (error) {
        this.storageBlocked = true;
        this.configError = 'Existing phone settings could not be read and were left unchanged: ' + error.message;
      }
      if (!this.storageBlocked && !isValidConfig(this.config)) {
        this.storageBlocked = true;
        this.configError = 'Existing phone settings are invalid and were left unchanged.';
      }
      if (this.storageBlocked) {
        this.config = newConfig();
        this.config.enabled = false;
      }
      if (!this.storageBlocked && !this.config.replyTopic) this.config.replyTopic = this.config.topic + '-reply';
      if (!this.storageBlocked && this.config.enabled === undefined) this.config.enabled = false;
      if (!this.storageBlocked && this.config.contentFree === undefined) this.config.contentFree = false;
      if (!this.storageBlocked && this.config.pairingDismissed === undefined) this.config.pairingDismissed = false;
    }
    this.subscribeRequest = null;
    this.subscribeResponse = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.stopped = false;
    this.status = { connected: false, message: this.configError || this.ntfyError || (this.config.enabled ? 'Connecting to ' + this.ntfyBaseUrl + '…' : 'Phone alerts are off') };
    if (!this.storageBlocked) this.save();
    this.qrDataUrl = null;
    this.qrPromise = this.ntfyBaseUrl ? QRCode.toString(ntfyPairingUrl(this.ntfyBaseUrl, this.config.topic), {
      type: 'svg', margin: 2, width: 190, errorCorrectionLevel: 'M',
      color: { dark: '#10212b', light: '#ffffff' }
    }).then((svg) => {
      this.qrDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      return this.qrDataUrl;
    }) : Promise.resolve(null);
    if (this.config.enabled && !this.storageBlocked) this.connect();
  }

  save() {
    if (this.storageBlocked) return false;
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2) + '\n', { mode: 0o600 });
    return true;
  }

  async pairingInfo() {
    return {
      topic: this.storageBlocked ? '' : this.config.topic,
      pairingUrl: this.storageBlocked || !this.ntfyBaseUrl ? '' : ntfyPairingUrl(this.ntfyBaseUrl, this.config.topic),
      qrDataUrl: this.storageBlocked ? null : await this.qrPromise,
      enabled: Boolean(this.config.enabled),
      contentFree: Boolean(this.config.contentFree),
      pairingDismissed: Boolean(this.config.pairingDismissed),
      status: { ...this.status }
    };
  }

  viewState() {
    return {
      topic: this.storageBlocked ? '' : this.config.topic,
      pairingUrl: this.storageBlocked || !this.ntfyBaseUrl ? '' : ntfyPairingUrl(this.ntfyBaseUrl, this.config.topic),
      qrDataUrl: this.storageBlocked ? null : this.qrDataUrl,
      enabled: Boolean(this.config.enabled),
      contentFree: Boolean(this.config.contentFree),
      pairingDismissed: Boolean(this.config.pairingDismissed),
      status: { ...this.status }
    };
  }

  setStatus(connected, message) {
    this.status = { connected, message };
    this.emit('status', { ...this.status });
  }

  async publishRequest(item) {
    if (!this.config.enabled || this.stopped) return false;
    if (!this.ntfyBaseUrl) { this.setStatus(false, this.ntfyError || 'ntfy URL is unavailable'); return false; }
    const target = this.ntfyBaseUrl + '/';
    const body = JSON.stringify(notificationFor(item, this.config, this.ntfyBaseUrl));
    const request = transportFor(target).request(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, (response) => {
      response.resume();
      if (response.statusCode >= 200 && response.statusCode < 300) {
        this.setStatus(this.status.connected, 'Request sent to phone');
      } else {
        this.setStatus(this.status.connected, 'ntfy publish failed (HTTP ' + response.statusCode + ')');
      }
    });
    request.setTimeout(8000, () => request.destroy(new Error('timeout')));
    request.on('error', () => this.setStatus(this.status.connected, 'Could not reach ' + this.ntfyBaseUrl));
    request.end(body);
    return true;
  }

  receive(message) {
    const parts = String(message || '').split(':');
    if (parts.length !== 3) return false;
    const [id, decision, suppliedMac] = parts;
    if (!id || !['allow', 'deny'].includes(decision)) return false;
    if (!verifyMac(this.config.secret, id, decision, suppliedMac)) return false;
    const settled = this.core.settle(id, decision, 'phone');
    if (settled) this.setStatus(this.status.connected, 'Phone decision received');
    return settled;
  }

  parseStream(data) {
    this.buffer = (this.buffer || '') + data;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch (_) { continue; }
      if (event.event === 'open') {
        this.reconnectDelay = 1000;
        this.setStatus(true, 'Connected to ' + this.ntfyBaseUrl);
      } else if (event.event === 'message') {
        this.receive(event.message);
      }
    }
  }

  scheduleReconnect() {
    if (this.stopped || !this.config.enabled || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
    this.setStatus(false, 'Reconnecting to ' + this.ntfyBaseUrl + '…');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  connect() {
    if (this.stopped || !this.config.enabled || this.subscribeRequest) return;
    if (!this.ntfyBaseUrl) { this.setStatus(false, this.ntfyError || 'ntfy URL is unavailable'); return; }
    this.buffer = '';
    const url = this.ntfyBaseUrl + '/' + encodeURIComponent(this.config.replyTopic) + '/json';
    const request = transportFor(url).get(url, (response) => {
      this.subscribeResponse = response;
      if (response.statusCode !== 200) {
        this.setStatus(false, 'ntfy subscription failed (HTTP ' + response.statusCode + ')');
        response.resume();
        this.subscribeRequest = null;
        this.subscribeResponse = null;
        this.scheduleReconnect();
        return;
      }
      response.setEncoding('utf8');
      response.on('data', (chunk) => this.parseStream(chunk));
      response.on('end', () => {
        this.subscribeRequest = null;
        this.subscribeResponse = null;
        if (!this.stopped) this.scheduleReconnect();
      });
      response.on('error', () => {
        this.subscribeRequest = null;
        this.subscribeResponse = null;
        this.scheduleReconnect();
      });
    });
    this.subscribeRequest = request;
    request.on('error', () => {
      this.subscribeRequest = null;
      this.subscribeResponse = null;
      this.scheduleReconnect();
    });
  }

  setEnabled(enabled) {
    if (this.storageBlocked) return false;
    this.config.enabled = Boolean(enabled);
    this.save();
    if (this.config.enabled) {
      this.stopped = false;
      this.setStatus(false, 'Connecting to ' + (this.ntfyBaseUrl || 'ntfy') + '…');
      this.connect();
    } else {
      this.stopConnection();
      this.setStatus(false, 'Phone alerts are off');
    }
    return true;
  }

  setContentFree(contentFree) {
    if (this.storageBlocked) return false;
    this.config.contentFree = Boolean(contentFree);
    this.save();
    return true;
  }

  dismissPairing() {
    if (this.storageBlocked) return false;
    this.config.pairingDismissed = true;
    this.save();
    return true;
  }

  stopConnection() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.subscribeResponse) this.subscribeResponse.destroy();
    if (this.subscribeRequest) this.subscribeRequest.destroy();
    this.subscribeResponse = null;
    this.subscribeRequest = null;
  }

  close() {
    this.stopConnection();
  }
}

module.exports = {
  PhoneBridge, isValidConfig, macFor, verifyMac, redact, truncate, truncateMiddle,
  ntfyBaseUrl, ntfyPairingUrl, phonePreview, phoneMessage, action, notificationFor
};
