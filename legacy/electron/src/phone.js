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
    enabled: false,
    pairingDismissed: false
  };
}

function isValidConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  if (!/^[a-f0-9]{32}$/i.test(config.topic || '')) return false;
  if (config.replyTopic !== undefined && config.replyTopic !== config.topic + '-reply') return false;
  if (config.secret !== undefined && !/^[a-f0-9]{64}$/i.test(config.secret)) return false;
  return ['enabled', 'contentFree', 'pairingDismissed'].every((key) => config[key] === undefined || typeof config[key] === 'boolean');
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

function notificationFor(_item, config) {
  return {
    topic: config.topic,
    title: 'Jicho needs your attention',
    message: 'An agent is waiting. Review it in Jicho on your computer.',
    priority: 3
  };
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
      if (!this.storageBlocked && this.config.enabled === undefined) this.config.enabled = false;
      if (!this.storageBlocked && this.config.pairingDismissed === undefined) this.config.pairingDismissed = false;
    }
    this.stopped = false;
    this.status = { connected: false, message: this.configError || this.ntfyError || (this.config.enabled ? 'Alert publishing is enabled; phone decisions are unavailable' : 'Phone alerts are off') };
    // Migrate old ntfy credentials out of local settings. They were published
    // inside notification actions and cannot provide device-bound approval.
    delete this.config.secret;
    delete this.config.replyTopic;
    delete this.config.contentFree;
    if (!this.storageBlocked) this.save();
    this.qrDataUrl = null;
    this.qrPromise = this.ntfyBaseUrl ? QRCode.toString(ntfyPairingUrl(this.ntfyBaseUrl, this.config.topic), {
      type: 'svg', margin: 2, width: 190, errorCorrectionLevel: 'M',
      color: { dark: '#10212b', light: '#ffffff' }
    }).then((svg) => {
      this.qrDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      return this.qrDataUrl;
    }) : Promise.resolve(null);
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
    const body = JSON.stringify(notificationFor(item, this.config));
    const request = transportFor(target).request(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, (response) => {
      response.resume();
      if (response.statusCode >= 200 && response.statusCode < 300) {
        this.setStatus(false, 'Generic alert accepted by ntfy; device receipt is unknown');
      } else {
        this.setStatus(this.status.connected, 'ntfy publish failed (HTTP ' + response.statusCode + ')');
      }
    });
    request.setTimeout(8000, () => request.destroy(new Error('timeout')));
    request.on('error', () => this.setStatus(this.status.connected, 'Could not reach ' + this.ntfyBaseUrl));
    request.end(body);
    return true;
  }

  setEnabled(enabled) {
    if (this.storageBlocked) return false;
    this.config.enabled = Boolean(enabled);
    this.save();
    this.stopped = false;
    this.setStatus(false, this.config.enabled ? 'Alert publishing is enabled; phone decisions are unavailable' : 'Phone alerts are off');
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
  }

  close() {
    this.stopConnection();
  }
}

module.exports = {
  PhoneBridge, isValidConfig, ntfyBaseUrl, ntfyPairingUrl, notificationFor
};
