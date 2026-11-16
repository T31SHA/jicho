'use strict';

const crypto = require('crypto');
const fs = require('fs');
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

function commandText(item) {
  if (item.input && Object.prototype.hasOwnProperty.call(item.input, 'command')) return item.input.command;
  return JSON.stringify(item.input || {});
}

function phoneMessage(item, contentFree) {
  if (contentFree) return 'Approval needed';
  const folder = String(item.cwd || 'session').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'session';
  return truncate(redact(folder + ' · ' + (item.tool || 'Tool') + ': ' + commandText(item)));
}

function action(topic, label, id, decision, secret) {
  return {
    action: 'http',
    label,
    url: NTFY + '/' + topic,
    method: 'POST',
    body: id + ':' + decision + ':' + macFor(secret, id, decision),
    clear: true
  };
}

class PhoneBridge extends EventEmitter {
  constructor(core, userDataDir) {
    super();
    this.core = core;
    this.directory = userDataDir;
    this.configPath = path.join(userDataDir, CONFIG_NAME);
    fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
    this.isFirstRun = !fs.existsSync(this.configPath);
    if (this.isFirstRun) this.config = newConfig();
    else {
      try { this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); }
      catch (_) { this.config = newConfig(); this.isFirstRun = true; }
      if (!this.config || typeof this.config.topic !== 'string' || typeof this.config.secret !== 'string') {
        this.config = newConfig(); this.isFirstRun = true;
      }
      if (!this.config.replyTopic) this.config.replyTopic = this.config.topic + '-reply';
      if (this.config.enabled === undefined) this.config.enabled = false;
      if (this.config.contentFree === undefined) this.config.contentFree = false;
      if (this.config.pairingDismissed === undefined) this.config.pairingDismissed = false;
    }
    this.subscribeRequest = null;
    this.subscribeResponse = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.stopped = false;
    this.status = { connected: false, message: this.config.enabled ? 'Connecting to ntfy…' : 'Phone alerts are off' };
    this.save();
    this.qrDataUrl = null;
    this.qrPromise = QRCode.toString('ntfy://ntfy.sh/' + this.config.topic, {
      type: 'svg', margin: 2, width: 190, errorCorrectionLevel: 'M',
      color: { dark: '#10212b', light: '#ffffff' }
    }).then((svg) => {
      this.qrDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      return this.qrDataUrl;
    });
    if (this.config.enabled) this.connect();
  }

  save() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2) + '\n', { mode: 0o600 });
  }

  async pairingInfo() {
    return {
      topic: this.config.topic,
      pairingUrl: 'ntfy://ntfy.sh/' + this.config.topic,
      qrDataUrl: await this.qrPromise,
      enabled: Boolean(this.config.enabled),
      contentFree: Boolean(this.config.contentFree),
      pairingDismissed: Boolean(this.config.pairingDismissed),
      status: { ...this.status }
    };
  }

  viewState() {
    return {
      topic: this.config.topic,
      pairingUrl: 'ntfy://ntfy.sh/' + this.config.topic,
      qrDataUrl: this.qrDataUrl,
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
    const body = JSON.stringify({
      topic: this.config.topic,
      title: 'Jicho approval needed',
      message: phoneMessage(item, this.config.contentFree),
      priority: 4,
      actions: [
        action(this.config.replyTopic, 'Approve', item.id, 'allow', this.config.secret),
        action(this.config.replyTopic, 'Deny', item.id, 'deny', this.config.secret)
      ]
    });
    const request = https.request(NTFY + '/', {
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
    request.on('error', () => this.setStatus(this.status.connected, 'Could not reach ntfy.sh'));
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
        this.setStatus(true, 'Connected to ntfy.sh');
      } else if (event.event === 'message') {
        this.receive(event.message);
      }
    }
  }

  scheduleReconnect() {
    if (this.stopped || !this.config.enabled || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
    this.setStatus(false, 'Reconnecting to ntfy.sh…');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  connect() {
    if (this.stopped || !this.config.enabled || this.subscribeRequest) return;
    this.buffer = '';
    const url = NTFY + '/' + encodeURIComponent(this.config.replyTopic) + '/json';
    const request = https.get(url, (response) => {
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
    this.config.enabled = Boolean(enabled);
    this.save();
    if (this.config.enabled) {
      this.stopped = false;
      this.setStatus(false, 'Connecting to ntfy.sh…');
      this.connect();
    } else {
      this.stopConnection();
      this.setStatus(false, 'Phone alerts are off');
    }
  }

  setContentFree(contentFree) {
    this.config.contentFree = Boolean(contentFree);
    this.save();
  }

  dismissPairing() {
    this.config.pairingDismissed = true;
    this.save();
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

module.exports = { PhoneBridge, macFor, verifyMac, redact, truncate, phoneMessage, action };
