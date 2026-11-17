'use strict';

function selectMascotMood({ pendingCount = 0, working = false, doneUntil = 0, error = '', now = Date.now() } = {}) {
  if (pendingCount > 0) return 'needs-you';
  if (error) return 'offline';
  if (working) return 'working';
  if (doneUntil > now) return 'done';
  return 'idle';
}

module.exports = { selectMascotMood };
