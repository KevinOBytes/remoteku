#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'darwin') {
  process.exit(0);
}

const plistPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'Info.plist'
);

if (!fs.existsSync(plistPath)) {
  console.warn('patch_electron_plist: Electron Info.plist not found, skipping.');
  process.exit(0);
}

const description = 'RemoteKu needs access to your local network to discover and control Roku devices.';
const plistBuddy = '/usr/libexec/PlistBuddy';

const runPlistBuddy = (command) => {
  return spawnSync(plistBuddy, ['-c', command, plistPath], {
    encoding: 'utf8'
  });
};

const current = runPlistBuddy('Print :NSLocalNetworkUsageDescription');
if (current.status === 0) {
  if (current.stdout.trim() !== description) {
    const setResult = runPlistBuddy(`Set :NSLocalNetworkUsageDescription "${description}"`);
    if (setResult.status !== 0) {
      console.warn('patch_electron_plist: Unable to update NSLocalNetworkUsageDescription.');
    }
  }
  process.exit(0);
}

const addResult = runPlistBuddy(`Add :NSLocalNetworkUsageDescription string "${description}"`);
if (addResult.status !== 0) {
  console.warn('patch_electron_plist: Unable to add NSLocalNetworkUsageDescription.');
}
