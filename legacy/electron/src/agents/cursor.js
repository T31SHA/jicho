'use strict';

const { EventEmitter } = require('events');
const { normalizeCursorEvent } = require('./protocol');

class CursorAdapter {
  constructor() {
    this.id = 'cursor';
    this.name = 'Cursor';
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
      evidence: detected ? 'authenticated-cursor-hook-event' : 'no-session-evidence',
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

  normalize(payload) { return normalizeCursorEvent(payload); }

  healthCheck() {
    return { healthy: this.connected, lastEventAt: this.lastEventAt || null, sessionIdentified: Boolean(this.lastSessionId) };
  }

  getCapabilities(context = {}) {
    return {
      detected: Boolean(context.detected),
      connected: Boolean(context.connected),
      sessionIdentified: Boolean(context.sessionIdentified),
      activityMonitored: true,
      permissionInterception: false,
      questionHandling: false,
      diffAvailable: false,
      remoteDecisionsSupported: false,
      hostApplicationDetection: false
    };
  }

  handleDecision() { return false; }

  record(event) {
    this.connected = true;
    this.lastEventAt = event.observedAt;
    this.lastSessionId = event.sessionId;
    this.events.emit('event', event);
  }
}

module.exports = { CursorAdapter };
