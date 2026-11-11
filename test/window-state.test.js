const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WindowStateManager = require('../window-state');

test('WindowStateManager returns defaults when state file does not exist', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteku-winstate-'));
  const filePath = path.join(tempDir, 'window-state.json');

  const manager = new WindowStateManager(filePath);
  const state = manager.load();

  assert.equal(state.isMiniMode, false);
  assert.equal(state.closeToTray, true);
  assert.equal(state.soundEffects, true);
  assert.equal(state.normalBounds.width, 1080);
  assert.equal(state.normalBounds.height, 840);
  assert.equal(state.miniBounds.width, 340);
  assert.equal(state.miniBounds.height, 780);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('WindowStateManager preserves custom normal bounds across Mini Mode toggles and reloads', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteku-winstate-'));
  const filePath = path.join(tempDir, 'window-state.json');

  const manager = new WindowStateManager(filePath);
  manager.load();

  // User resizes and moves normal window
  const customNormal = { width: 1240, height: 900, x: 120, y: 80 };
  manager.updateNormalBounds(customNormal);

  // Enter Mini Mode while passing current normal window bounds
  const enterMini = manager.setMiniMode(true, customNormal);
  assert.equal(enterMini.isMiniMode, true);
  assert.equal(enterMini.targetBounds.width, 340);
  assert.equal(enterMini.targetBounds.height, 780);

  // Move Mini window
  manager.updateMiniBounds({ width: 340, height: 780, x: 900, y: 40 });

  // Exit Mini Mode and verify custom normal bounds are restored instead of hardcoded defaults
  const exitMini = manager.setMiniMode(false, { width: 340, height: 780, x: 900, y: 40 });
  assert.equal(exitMini.isMiniMode, false);
  assert.deepEqual(exitMini.targetBounds, customNormal);

  // Reload from disk in a fresh instance
  const reloaded = new WindowStateManager(filePath).load();
  assert.deepEqual(reloaded.normalBounds, customNormal);
  assert.deepEqual(reloaded.miniBounds, { width: 340, height: 780, x: 900, y: 40 });

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('WindowStateManager handles corrupt JSON gracefully and persists preferences', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteku-winstate-'));
  const filePath = path.join(tempDir, 'window-state.json');
  fs.writeFileSync(filePath, '{corrupt json', 'utf8');

  const manager = new WindowStateManager(filePath);
  const state = manager.load();
  assert.equal(state.isMiniMode, false);

  const updated = manager.updatePreferences({
    closeToTray: false,
    soundEffects: false,
    alwaysOnTop: true
  });
  assert.equal(updated.closeToTray, false);
  assert.equal(updated.soundEffects, false);
  assert.equal(updated.alwaysOnTop, true);

  const reloaded = new WindowStateManager(filePath).load();
  assert.equal(reloaded.closeToTray, false);
  assert.equal(reloaded.soundEffects, false);
  assert.equal(reloaded.alwaysOnTop, true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
