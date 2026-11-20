#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const path = require('path');

function electronArgs(platform, env, appPath, extraArgs = []) {
  const forceX11 = platform === 'linux' && env.XDG_SESSION_TYPE === 'wayland' && Boolean(env.DISPLAY);
  return [
    ...(forceX11 ? ['--ozone-platform=x11'] : []),
    ...extraArgs,
    appPath
  ];
}

function start() {
  const electron = require('electron');
  const appPath = path.resolve(__dirname, '..');
  const child = spawn(electron, electronArgs(process.platform, process.env, appPath, process.argv.slice(2)), { stdio: 'inherit' });
  child.once('error', (error) => {
    console.error('Could not launch Jicho:', error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code === null ? (signal === 'SIGINT' ? 130 : 1) : code;
  });
}

if (require.main === module) start();

module.exports = { electronArgs, start };
