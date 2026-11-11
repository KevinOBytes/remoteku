const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeHostInput,
  formatDurationMs,
  formatPlaybackProgress,
  resolveShortcutKey,
  mergePinnedApps,
  togglePinnedAppId,
  filterApps,
  getAppMonogram
} = require('../renderer-logic');

test('normalizeHostInput adds default scheme and 8060 port and rejects invalid hosts', () => {
  const ipOnly = normalizeHostInput('192.168.1.25');
  assert.equal(ipOnly.origin, 'http://192.168.1.25:8060');

  const withCustomPort = normalizeHostInput('http://10.0.0.8:9060');
  assert.equal(withCustomPort.origin, 'http://10.0.0.8:9060');

  assert.equal(normalizeHostInput(''), null);
  assert.equal(normalizeHostInput('   '), null);
  assert.equal(normalizeHostInput('http://'), null);
});

test('formatDurationMs and formatPlaybackProgress format timecodes and percentages', () => {
  assert.equal(formatDurationMs(null), '—');
  assert.equal(formatDurationMs(-5), '—');
  assert.equal(formatDurationMs(0), '0:00');
  assert.equal(formatDurationMs(65000), '1:05');
  assert.equal(formatDurationMs(3661000), '1:01:01');

  const progress = formatPlaybackProgress(30000, 120000);
  assert.deepEqual(progress, {
    elapsedText: '0:30',
    durationText: '2:00',
    percent: 25
  });

  const clamped = formatPlaybackProgress(180000, 120000);
  assert.equal(clamped.percent, 100);
});

test('resolveShortcutKey maps remote keys and UI shortcuts while guarding modifier combos', () => {
  assert.deepEqual(resolveShortcutKey({ key: 'ArrowUp' }), { type: 'roku', key: 'Up' });
  assert.deepEqual(resolveShortcutKey({ key: 'w' }), { type: 'roku', key: 'Up' });
  assert.deepEqual(resolveShortcutKey({ key: 'Enter' }), { type: 'roku', key: 'Select' });
  assert.deepEqual(resolveShortcutKey({ key: ' ' }), { type: 'roku', key: 'Play', isPlayToggle: true });
  assert.deepEqual(resolveShortcutKey({ key: 'm' }), { type: 'roku', key: 'VolumeMute' });
  assert.deepEqual(resolveShortcutKey({ key: '+' }), { type: 'roku', key: 'VolumeUp' });
  assert.deepEqual(resolveShortcutKey({ key: '-' }), { type: 'roku', key: 'VolumeDown' });
  assert.deepEqual(resolveShortcutKey({ key: 'i' }), { type: 'roku', key: 'Info' });
  assert.deepEqual(resolveShortcutKey({ key: '*' }), { type: 'roku', key: 'Info' });
  assert.deepEqual(resolveShortcutKey({ key: 'r' }), { type: 'roku', key: 'InstantReplay' });
  assert.deepEqual(resolveShortcutKey({ key: '[' }), { type: 'roku', key: 'Rev' });
  assert.deepEqual(resolveShortcutKey({ key: ']' }), { type: 'roku', key: 'Fwd' });
  assert.deepEqual(resolveShortcutKey({ key: 'h' }), { type: 'roku', key: 'Home' });
  assert.deepEqual(resolveShortcutKey({ key: '?' }), { type: 'ui', action: 'toggle-shortcuts-modal' });
  assert.deepEqual(resolveShortcutKey({ key: '/' }), { type: 'ui', action: 'focus-keyboard' });
  assert.deepEqual(resolveShortcutKey({ key: 'k', metaKey: true }), { type: 'ui', action: 'focus-keyboard' });
  assert.deepEqual(resolveShortcutKey({ key: 'f', ctrlKey: true }), { type: 'ui', action: 'focus-apps-search' });

  // Standard system shortcuts like Cmd+C or Cmd+V must not fire Roku keys
  assert.equal(resolveShortcutKey({ key: 'c', metaKey: true }), null);
  assert.equal(resolveShortcutKey({ key: 'v', ctrlKey: true }), null);
  assert.equal(resolveShortcutKey({ key: 'm', altKey: true }), null);
});

test('togglePinnedAppId and mergePinnedApps manage customizable 6-button remote shortcuts', () => {
  let pins = ['12', '837'];
  const added = togglePinnedAppId(pins, '444', 6);
  assert.equal(added.action, 'pinned');
  assert.deepEqual(added.pinnedIds, ['12', '837', '444']);

  const removed = togglePinnedAppId(added.pinnedIds, '837', 6);
  assert.equal(removed.action, 'unpinned');
  assert.deepEqual(removed.pinnedIds, ['12', '444']);

  const full = togglePinnedAppId(['1', '2', '3', '4', '5', '6'], '7', 6);
  assert.equal(full.action, 'limit-reached');
  assert.equal(full.pinnedIds.length, 6);

  const installed = [
    { id: '999', name: 'Plex' },
    { id: '12', name: 'Netflix' },
    { id: '888', name: 'Spotify' }
  ];
  const merged = mergePinnedApps(['999', '888'], installed);
  assert.equal(merged.length, 6);
  assert.equal(merged[0].id, '999');
  assert.equal(merged[0].name, 'Plex');
  assert.equal(merged[0].pinned, true);
  assert.equal(merged[1].id, '888');
  assert.equal(merged[1].name, 'Spotify');
  assert.equal(merged[1].pinned, true);
});

test('filterApps filters by search query, pinned mode, and sorts pinned apps first', () => {
  const apps = [
    { id: '1', name: 'YouTube' },
    { id: '2', name: 'Apple TV' },
    { id: '3', name: 'Plex' }
  ];

  const sorted = filterApps(apps, { pinnedIds: ['3'] });
  assert.deepEqual(sorted.map((a) => a.name), ['Plex', 'Apple TV', 'YouTube']);

  const searched = filterApps(apps, { query: 'apple', pinnedIds: ['3'] });
  assert.deepEqual(searched.map((a) => a.name), ['Apple TV']);

  const pinnedOnly = filterApps(apps, { pinnedIds: ['3'], filterMode: 'pinned' });
  assert.deepEqual(pinnedOnly.map((a) => a.name), ['Plex']);
});

test('getAppMonogram builds clean monograms for app tiles', () => {
  assert.equal(getAppMonogram('Netflix'), 'N');
  assert.equal(getAppMonogram('Prime Video'), 'PV');
  assert.equal(getAppMonogram('Disney+'), 'D+');
  assert.equal(getAppMonogram(''), 'RK');
});
