'use strict';

const { EventEmitter } = require('events');
const { normalizeCodexEvent } = require('./protocol');

class CodexAdapter {
  constructor(options = {}) {
    this.id = 'codex';
    this.name = 'OpenAI Codex';
    this.core = options.core || null;
    this.events = new EventEmitter();
    this.connected = false;
    this.lastEventAt = 0;
    this.lastSessionId = '';
  }

  async discover(evidence = {}) {
    const detected = Boolean(evidence.authenticatedHookEvent);
    return {
      agentId: this.id,
      detected,
      evidence: detected ? 'authenticated-codex-hook-event' : 'no-session-evidence',
      hostApplicationDetected: false
    };
  }

  identify(payload) {
    const event = this.normalize(payload);
    return event ? { agentId: this.id, sessionId: event.sessionId, projectRoot: event.projectRoot } : null;
  }

  async connect() { return { connected: this.connected, transport: 'authenticated-command-hook' }; }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('An event listener is required.');
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  normalize(payload) { return normalizeCodexEvent(payload); }

  healthCheck() {
    return { healthy: this.connected, lastEventAt: this.lastEventAt || null, sessionIdentified: Boolean(this.lastSessionId) };
  }

  getCapabilities(context = {}) {
    return {
      detected: Boolean(context.detected),
      connected: Boolean(context.connected),
      sessionIdentified: Boolean(context.sessionIdentified),
      activityMonitored: true,
      permissionInterception: 'permission-request-hook-only',
      questionHandling: false,
      diffAvailable: false,
      remoteDecisionsSupported: false,
      hostApplicationDetection: false
    };
  }

  handleDecision(requestId, decision, source = 'adapter') {
    if (!this.core || !['allow', 'deny'].includes(decision)) return false;
    return this.core.settle(requestId, decision, source);
  }

  record(event) {
    this.connected = true;
    this.lastEventAt = event.observedAt;
    this.lastSessionId = event.sessionId;
    this.events.emit('event', event);
  }
}

module.exports = { CodexAdapter };
