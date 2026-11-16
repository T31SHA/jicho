'use strict';

const { pathToFileURL } = require('url');

function isTrustedMainFrame(event, expectedFiles) {
  if (!event || !event.sender || !event.senderFrame || !Array.isArray(expectedFiles)) return false;
  if (event.senderFrame !== event.sender.mainFrame) return false;
  const allowed = expectedFiles.map((filename) => pathToFileURL(filename).href);
  return allowed.includes(event.senderFrame.url);
}

module.exports = { isTrustedMainFrame };
