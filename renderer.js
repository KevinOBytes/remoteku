// Use the exposed Roku API from preload script
// rokuAPI is injected globally by preload.js using contextBridge
// DOM elements
const deviceSelect = document.getElementById('device-select');
const refreshDevicesBtn = document.getElementById('refresh-devices');
const manualHostInput = document.getElementById('manual-host');
const manualConnectBtn = document.getElementById('manual-connect');
const refreshAppsBtn = document.getElementById('refresh-apps');
const appsContainer = document.getElementById('apps-container');
const appsCount = document.getElementById('apps-count');
const localIps = document.getElementById('local-ips');
const discoveryStatus = document.getElementById('discovery-status');
const lastScan = document.getElementById('last-scan');
const testConnectionBtn = document.getElementById('test-connection');
const testResult = document.getElementById('test-result');
const audioControl = document.getElementById('audio-control');
const volumeMute = document.getElementById('volume-mute');
const statusMessage = document.getElementById('status-message');
const statusDot = document.getElementById('status-dot');
const currentDeviceLabel = document.getElementById('current-device');
const playPauseToggle = document.getElementById('play-pause-toggle');
const quickAppsContainer = document.getElementById('quick-apps-container');
const quickAppsCount = document.getElementById('quick-apps-count');

// Configuration
const STATUS_DISPLAY_DURATION = 3000;
const KEY_PRESS_FEEDBACK_DURATION = 1000;
const PERMISSION_ERROR_CODES = new Set(['EACCES', 'EPERM']);
const STORAGE_KEY = 'remoteku:lastDevice';
const DISCOVERY_OPTIONS = { fallbackScan: true, throwOnPermission: true };
const QUICK_LAUNCH_FAVORITES = [
  { name: 'Netflix', id: '12', matcher: /netflix/i, accent: '#e50914' },
  { name: 'YouTube', id: '837', matcher: /youtube|you tube/i, accent: '#ff0033' },
  { name: 'Hulu', id: '2285', matcher: /hulu/i, accent: '#1ce783' },
  { name: 'Max', id: '61322', matcher: /\bmax\b|hbo/i, accent: '#2f63ff' },
  { name: 'Disney+', id: '291097', matcher: /disney/i, accent: '#5b8dff' },
  { name: 'Prime Video', id: '13', matcher: /prime video|amazon/i, accent: '#00a8e1' }
];
const QUICK_LAUNCH_LIMIT = 5;

// State
// Note: isPlaying tracks state locally and may not reflect actual Roku device state
// if controlled by physical remote or another app. Roku ECP API doesn't provide
// real-time playback state queries.
let isPlaying = false;
let statusTimeoutId = null;

// Status message helper
function setStatus(message, { duration = STATUS_DISPLAY_DURATION, state = 'idle' } = {}) {
  statusMessage.textContent = message;
  if (statusDot) {
    statusDot.className = `status-dot ${state}`;
  }
  if (statusTimeoutId) {
    clearTimeout(statusTimeoutId);
  }
  if (duration > 0) {
    statusTimeoutId = setTimeout(() => {
      statusMessage.textContent = 'Ready';
      if (statusDot) {
        statusDot.className = 'status-dot idle';
      }
    }, duration);
  }
}

function isTextEntryContext(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function triggerVisualFeedback(keyElement) {
  if (!keyElement) return;
  keyElement.classList.add('active-press');
  setTimeout(() => {
    keyElement.classList.remove('active-press');
  }, 150);
}

function playPauseIconMarkup(playing) {
  if (playing) {
    return `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="6" y="4" width="4" height="16" rx="1"></rect>
        <rect x="14" y="4" width="4" height="16" rx="1"></rect>
      </svg>
    `;
  }

  return `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  `;
}

function updatePlayPauseButton() {
  if (!playPauseToggle) {
    return;
  }
  playPauseToggle.innerHTML = playPauseIconMarkup(isPlaying);
  playPauseToggle.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  playPauseToggle.setAttribute('title', isPlaying ? 'Pause' : 'Play');
}

function setVolumeControlAvailability(supportsAudio) {
  document.body.classList.toggle('audio-unsupported', supportsAudio === false);
  document.querySelectorAll('[data-key="VolumeUp"], [data-key="VolumeDown"], [data-key="VolumeMute"]').forEach((button) => {
    const unsupported = supportsAudio === false;
    if (!button.dataset.defaultTitle) {
      button.dataset.defaultTitle = button.title || button.getAttribute('aria-label') || 'Volume control';
    }
    button.setAttribute('aria-disabled', unsupported ? 'true' : 'false');
    button.title = unsupported
      ? `${button.getAttribute('aria-label') || 'Volume control'} may not be supported by this Roku`
      : button.dataset.defaultTitle;
  });
}

function getFavoriteMeta(app) {
  return QUICK_LAUNCH_FAVORITES.find((favorite) => {
    const appName = app?.name || '';
    return app?.id === favorite.id || favorite.matcher.test(appName);
  });
}

function getQuickAccent(app) {
  return getFavoriteMeta(app)?.accent || '#22d3ee';
}

function getQuickLaunchApps(apps) {
  const selected = [];
  const seenIds = new Set();

  QUICK_LAUNCH_FAVORITES.forEach((favorite) => {
    const match = apps.find((app) => {
      const appName = app?.name || '';
      return app?.id === favorite.id || favorite.matcher.test(appName);
    });
    if (match && !seenIds.has(match.id)) {
      selected.push(match);
      seenIds.add(match.id);
    }
  });

  apps.forEach((app) => {
    if (selected.length >= QUICK_LAUNCH_LIMIT) {
      return;
    }
    if (app?.id && !seenIds.has(app.id)) {
      selected.push(app);
      seenIds.add(app.id);
    }
  });

  return selected.slice(0, QUICK_LAUNCH_LIMIT);
}

function renderQuickApps(apps = []) {
  if (!quickAppsContainer) {
    return;
  }

  quickAppsContainer.replaceChildren();
  const quickApps = Array.isArray(apps) ? getQuickLaunchApps(apps) : [];

  if (quickAppsCount) {
    quickAppsCount.textContent = quickApps.length
      ? `${quickApps.length} app${quickApps.length === 1 ? '' : 's'}`
      : 'No apps';
  }

  if (quickApps.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'quick-empty';
    empty.textContent = 'Connect a Roku to load apps.';
    quickAppsContainer.appendChild(empty);
    return;
  }

  quickApps.forEach((app) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-app-btn';
    button.dataset.appId = app.id;
    button.style.setProperty('--quick-accent', getQuickAccent(app));
    button.title = `Launch ${app.name}`;

    const name = document.createElement('span');
    name.className = 'quick-app-name';
    name.textContent = app.name;

    const meta = document.createElement('span');
    meta.className = 'quick-app-meta';
    meta.textContent = getFavoriteMeta(app) ? 'Favorite' : 'App';

    button.append(name, meta);
    quickAppsContainer.appendChild(button);
  });
}

async function launchRokuApp(appId, appName, sourceElement) {
  if (!appId) {
    return;
  }

  triggerVisualFeedback(sourceElement);
  setStatus(`Launching ${appName}...`, { duration: 0, state: 'info' });

  try {
    const success = await rokuAPI.launchApp(appId);
    if (success) {
      setStatus(`Launched ${appName}`, { state: 'success' });
    } else {
      setStatus(`Failed to launch ${appName}`, { state: 'error' });
    }
  } catch (error) {
    console.error('Error launching app:', error);
    setStatus(`Failed to launch ${appName}`, { state: 'error' });
  }
}

async function sendRemoteKey(
  key,
  { pendingMessage = null, pendingDuration = KEY_PRESS_FEEDBACK_DURATION } = {}
) {
  // Trigger UI feedback
  const keyElement = document.querySelector(`[data-key="${key}"]`);
  triggerVisualFeedback(keyElement);

  if (pendingMessage) {
    setStatus(pendingMessage, { duration: pendingDuration, state: 'info' });
  }

  try {
    const success = await rokuAPI.sendKey(key);
    if (!success) {
      setStatus(`Failed to send ${key}`, { state: 'error' });
      return false;
    }
    return true;
  } catch (error) {
    const isNoDeviceSelected = error?.message === 'No device selected';
    const statusText = isNoDeviceSelected
      ? 'No device selected. Connect to a Roku first.'
      : `Error sending ${key}`;
    setStatus(statusText, { state: isNoDeviceSelected ? 'warning' : 'error' });
    return false;
  }
}

function updateCurrentDevice(device) {
  if (!currentDeviceLabel) {
    return;
  }
  if (!device) {
    currentDeviceLabel.textContent = 'Not connected';
    return;
  }
  const friendly = device.friendlyName || 'Roku Device';
  const ip = device.ip || device.host || '';
  currentDeviceLabel.textContent = ip ? `${friendly} · ${ip}` : friendly;
}

function normalizeHostInput(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.port) {
      url.port = '8060';
    }
    return url;
  } catch (error) {
    return null;
  }
}

function saveLastDevice(device) {
  if (!device || !device.host) {
    return;
  }
  const payload = {
    host: device.host,
    ip: device.ip,
    friendlyName: device.friendlyName
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to persist last device:', error);
  }
}

function loadLastDevice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && parsed.host ? parsed : null;
  } catch (error) {
    return null;
  }
}

function renderDeviceOptions(devices, selectedHost) {
  deviceSelect.innerHTML = '';
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = index;
    const label = `${device.friendlyName || 'Roku Device'} (${device.ip || device.host})`;
    option.textContent = label;
    deviceSelect.appendChild(option);
  });
  if (selectedHost) {
    const selectedIndex = devices.findIndex(device => device.host === selectedHost);
    if (selectedIndex >= 0) {
      deviceSelect.value = `${selectedIndex}`;
    }
  }
}

function setDiscoveryStatus(message) {
  if (discoveryStatus) {
    discoveryStatus.textContent = message;
  }
}

function setLastScan(timestamp) {
  if (lastScan) {
    lastScan.textContent = timestamp ? new Date(timestamp).toLocaleString() : '—';
  }
}

function setTestResult(message) {
  if (testResult) {
    testResult.textContent = message;
  }
}

function updateAudioIndicators(info) {
  setVolumeControlAvailability(info?.supportsAudioVolumeControl);

  if (audioControl) {
    const support = info?.supportsAudioVolumeControl;
    if (support === true) {
      audioControl.textContent = 'Supported';
    } else if (support === false) {
      audioControl.textContent = 'Unsupported';
    } else {
      audioControl.textContent = 'Unknown';
    }
  }

  if (volumeMute) {
    const volume = typeof info?.volume === 'number' ? info.volume : null;
    const muted = typeof info?.muted === 'boolean' ? info.muted : null;
    if (volume === null && muted === null) {
      volumeMute.textContent = 'Unavailable';
      return;
    }

    const volumeText = volume !== null ? `Vol ${volume}` : 'Vol —';
    const muteText = muted === null ? 'Mute —' : muted ? 'Muted' : 'Unmuted';
    volumeMute.textContent = `${volumeText} · ${muteText}`;
  }
}

async function refreshAudioIndicators(device) {
  if (!device?.host) {
    updateAudioIndicators(null);
    return;
  }
  try {
    const info = await rokuAPI.probeDevice(device.host);
    updateAudioIndicators(info);
  } catch (error) {
    updateAudioIndicators(null);
  }
}

async function loadNetworkInfo() {
  if (!localIps) {
    return;
  }
  try {
    const interfaces = await rokuAPI.getNetworkInfo();
    const addresses = interfaces
      .filter(item => (item.family === 'IPv4' || item.family === 4) && !item.internal)
      .map(item => `${item.name}: ${item.address}`);
    localIps.textContent = addresses.length > 0 ? addresses.join(', ') : 'No external IPv4 interfaces detected';
  } catch (error) {
    localIps.textContent = 'Unable to read network interfaces';
  }
}

async function connectToHost(hostInput, { remember = true, announce = true, silentFail = false } = {}) {
  const url = normalizeHostInput(hostInput);
  if (!url) {
    if (!silentFail) {
      setStatus('Enter a valid IP or host (example: 192.168.1.20)', { state: 'warning' });
    }
    return false;
  }

  const host = `${url.protocol}//${url.host}`;
  if (announce) {
    setStatus('Connecting...', { duration: 0, state: 'info' });
  }

  try {
    const info = await rokuAPI.probeDevice(host);
    const device = {
      host,
      ip: url.hostname,
      ...info
    };
    updateAudioIndicators(info);
    await rokuAPI.addDevice(device);
    const devices = await rokuAPI.getDevices();
    renderDeviceOptions(devices, host);

    await rokuAPI.setDevice(device);
    updateCurrentDevice(device);
    if (remember) {
      saveLastDevice(device);
    }
    if (announce) {
      setStatus(`Connected to ${device.friendlyName || 'Roku Device'}`, { state: 'success' });
    }
    const apps = await loadApps();
    if (announce && apps.length === 0) {
      setStatus('Connected, but no apps returned. Verify the IP and network.', { state: 'warning' });
    }
    return true;
  } catch (error) {
    console.error('Error connecting to host:', error);
    updateAudioIndicators(null);
    if (!silentFail) {
      setStatus('Connection failed. Check IP, port, and network.', { state: 'error' });
    }
    return false;
  }
}

// Discover devices on load
async function discoverDevices() {
  setStatus('Discovering Roku devices (SSDP + subnet scan)...', { duration: 0, state: 'info' });
  setDiscoveryStatus('Scanning (SSDP + subnet)...');
  setLastScan(Date.now());
  deviceSelect.innerHTML = '<option value="">Searching...</option>';
  setTestResult('—');
  const savedDevice = loadLastDevice();

  try {
    const devices = await rokuAPI.discoverDevices(DISCOVERY_OPTIONS);

    if (devices.length === 0) {
      deviceSelect.innerHTML = '<option value="">No devices found</option>';
      updateCurrentDevice(null);
      updateAudioIndicators(null);
      setDiscoveryStatus('None found');
      setStatus('No Roku devices found. Check Local Network access or use Manual IP.', {
        state: 'warning'
      });
      if (savedDevice?.host) {
        const reconnected = await connectToHost(savedDevice.host, {
          remember: true,
          announce: false,
          silentFail: true
        });
        if (reconnected) {
          setStatus(`Reconnected to ${savedDevice.friendlyName || 'Roku Device'}`, { state: 'success' });
        }
      }
      return;
    }

    renderDeviceOptions(devices, savedDevice?.host);
    setDiscoveryStatus(`Found ${devices.length}`);

    let selectedDevice = null;
    if (savedDevice?.host) {
      selectedDevice = devices.find(device => device.host === savedDevice.host);
      if (!selectedDevice) {
        const reconnected = await connectToHost(savedDevice.host, {
          remember: true,
          announce: false,
          silentFail: true
        });
        if (reconnected) {
          setStatus(`Reconnected to ${savedDevice.friendlyName || 'Roku Device'}`, { state: 'success' });
          return;
        }
      }
    }

    if (!selectedDevice) {
      selectedDevice = devices[0];
    }

    if (selectedDevice) {
      await rokuAPI.setDevice(selectedDevice);
      updateCurrentDevice(selectedDevice);
      saveLastDevice(selectedDevice);
      refreshAudioIndicators(selectedDevice);
      setStatus(`Connected to ${selectedDevice.friendlyName}`, { state: 'success' });
      await loadApps();
    }
  } catch (error) {
    console.error('Error discovering devices:', error);
    const permissionBlocked = PERMISSION_ERROR_CODES.has(error?.code);
    const statusText = permissionBlocked
      ? 'Discovery blocked - network permissions required (check firewall or run with appropriate privileges)'
      : 'Error discovering devices';
    deviceSelect.innerHTML = `<option value="">${statusText}</option>`;
    updateCurrentDevice(null);
    updateAudioIndicators(null);
    setDiscoveryStatus('Error');
    setStatus(statusText, { state: 'error' });
  }
}

// Handle device selection change
deviceSelect.addEventListener('change', async (e) => {
  const index = parseInt(e.target.value);
  const devices = await rokuAPI.getDevices();

  if (devices[index]) {
    await rokuAPI.setDevice(devices[index]);
    updateCurrentDevice(devices[index]);
    saveLastDevice(devices[index]);
    setStatus(`Switched to ${devices[index].friendlyName}`, { state: 'info' });
    refreshAudioIndicators(devices[index]);
    loadApps();
  }
});

// Refresh devices button
refreshDevicesBtn.addEventListener('click', () => {
  loadNetworkInfo();
  discoverDevices();
});

manualConnectBtn.addEventListener('click', async () => {
  await connectToHost(manualHostInput.value, { remember: true, announce: true });
});

manualHostInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    manualConnectBtn.click();
  }
});

testConnectionBtn?.addEventListener('click', async () => {
  const current = await rokuAPI.getCurrentDevice();
  if (!current || !current.host) {
    setTestResult('No device selected');
    setStatus('Select a device to test.', { state: 'warning' });
    return;
  }

  setTestResult('Testing...');
  setStatus('Testing device reachability...', { duration: 0, state: 'info' });

  try {
    const info = await rokuAPI.probeDevice(current.host);
    updateAudioIndicators(info);
    setTestResult(`OK · ${info.modelName || 'Roku'} · ${info.serialNumber || '—'}`);
    setStatus('Device reachable', { state: 'success' });
  } catch (error) {
    console.error('Connection test failed:', error);
    setTestResult('Failed');
    setStatus('Device unreachable', { state: 'error' });
  }
});

// Load apps from current device
async function loadApps() {
  appsContainer.replaceChildren();
  const loading = document.createElement('p');
  loading.textContent = 'Loading apps...';
  appsContainer.appendChild(loading);
  if (appsCount) {
    appsCount.textContent = 'Loading...';
  }

  try {
    const apps = await rokuAPI.getApps();

    if (apps.length === 0) {
      appsContainer.replaceChildren();
      const empty = document.createElement('p');
      empty.textContent = 'No apps found';
      appsContainer.appendChild(empty);
      renderQuickApps([]);
      if (appsCount) {
        appsCount.textContent = '0 apps';
      }
      return [];
    }

    appsContainer.replaceChildren();
    apps.forEach(app => {
      const tile = document.createElement('div');
      tile.className = 'app-tile';

      const name = document.createElement('div');
      name.className = 'app-name';
      name.textContent = app.name;

      const meta = document.createElement('div');
      meta.className = 'app-meta';
      meta.textContent = `v${app.version || '—'}`;

      tile.append(name, meta);
      tile.title = `${app.name} (v${app.version})`;
      tile.dataset.appId = app.id;
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('role', 'button');

      const launchTileApp = async () => {
        await launchRokuApp(app.id, app.name, tile);
      };

      tile.addEventListener('click', launchTileApp);

      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          launchTileApp();
        }
      });

      appsContainer.appendChild(tile);
    });
    renderQuickApps(apps);
    if (appsCount) {
      appsCount.textContent = `${apps.length} app${apps.length === 1 ? '' : 's'}`;
    }
    return apps;
  } catch (error) {
    console.error('Error loading apps:', error);
    appsContainer.replaceChildren();
    const errorMessage = document.createElement('p');
    errorMessage.textContent = 'Error loading apps';
    appsContainer.appendChild(errorMessage);
    renderQuickApps([]);
    if (appsCount) {
      appsCount.textContent = 'Error';
    }
    return [];
  }
}

// Refresh apps button
refreshAppsBtn.addEventListener('click', () => {
  loadApps();
});

// Tabs Logic
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.tab || btn.dataset.target;
    activateTab(targetId);
  });
});

function activateTab(targetId) {
  if (!targetId) return;
  const targetPane = document.getElementById(targetId);
  if (!targetPane) return;

  tabBtns.forEach((button) => {
    const buttonTarget = button.dataset.tab || button.dataset.target;
    button.classList.toggle('active', buttonTarget === targetId);
  });
  tabPanes.forEach((pane) => {
    pane.classList.toggle('active', pane.id === targetId);
  });
}

// Handle remote control buttons
document.querySelectorAll('[data-key]').forEach(button => {
  button.addEventListener('click', async (e) => {
    const key = e.currentTarget.dataset.key;
    if (!key) return;

    // Special handling for play/pause toggle
    if (e.currentTarget.id === 'play-pause-toggle') {
      const wasPlaying = isPlaying;
      const toggleKey = 'Play';
      isPlaying = !isPlaying;
      updatePlayPauseButton();
      const sent = await sendRemoteKey(toggleKey, {
        pendingMessage: 'Sending Play/Pause...',
        pendingDuration: KEY_PRESS_FEEDBACK_DURATION
      });
      if (!sent) {
        isPlaying = wasPlaying;
        updatePlayPauseButton();
      }
      return;
    }

    await sendRemoteKey(key, {
      pendingMessage: `Sending ${key}...`,
      pendingDuration: KEY_PRESS_FEEDBACK_DURATION
    });
  });
});

// Handle Quick App Launch buttons
quickAppsContainer?.addEventListener('click', async (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const button = target?.closest('.quick-app-btn');
  if (!button) return;

  const appId = button.dataset.appId;
  const appName = button.querySelector('.quick-app-name')?.textContent?.trim() || 'app';
  await launchRokuApp(appId, appName, button);
});

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  updateCurrentDevice(null);
  updateAudioIndicators(null);
  updatePlayPauseButton();
  renderQuickApps([]);
  setDiscoveryStatus('Idle');
  setLastScan(null);
  loadNetworkInfo();
  discoverDevices();
});

// Mini Mode Toggle
let isMiniMode = false;
const miniModeToggleBtn = document.getElementById('mini-mode-toggle');
if (miniModeToggleBtn) {
  miniModeToggleBtn.addEventListener('click', () => {
    isMiniMode = !isMiniMode;
    if (isMiniMode) {
      activateTab('tab-remote');
    }
    document.body.classList.toggle('mini-mode', isMiniMode);
    rokuAPI.toggleMiniMode(isMiniMode);
  });
}

// Keyboard shortcuts
document.addEventListener('keydown', async (e) => {
  if (isTextEntryContext(e.target)) {
    return;
  }

  const active = document.activeElement;
  const isInteractiveFocused = active && (
    active.tagName === 'BUTTON' ||
    active.tagName === 'A' ||
    active.tagName === 'SELECT' ||
    active.getAttribute('role') === 'button' ||
    active.classList.contains('tab-btn')
  );

  // If focused on an interactive element, allow Space and Enter to trigger native clicks
  if (isInteractiveFocused && (e.key === 'Enter' || e.key === ' ')) {
    return;
  }

  // Allow native arrow key navigation for select dropdowns 
  if (active && active.tagName === 'SELECT' && e.key.startsWith('Arrow')) {
    return;
  }

  // Handle Tab navigation with Left/Right arrows if a tab is focused
  if (active && active.classList.contains('tab-btn')) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const tabs = Array.from(document.querySelectorAll('.tab-btn'));
      const currentIndex = tabs.indexOf(active);
      if (currentIndex > -1) {
        let nextIndex = e.key === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1;
        if (nextIndex >= tabs.length) nextIndex = 0;
        if (nextIndex < 0) nextIndex = tabs.length - 1;
        tabs[nextIndex].focus();
        tabs[nextIndex].click();
      }
      return;
    }
  }

  if (e.key === ' ' || e.key === 'MediaPlayPause') {
    e.preventDefault();
    playPauseToggle?.click();
    return;
  }

  const keyMap = {
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Enter': 'Select',
    'Backspace': 'Back',
    'Escape': 'Back',
    'Home': 'Home'
  };

  const key = keyMap[e.key];
  if (key) {
    if (e.key === 'Backspace' || e.key === ' ') {
      e.preventDefault(); // Prevent navigating browser history or scrolling
    }
    const sent = await sendRemoteKey(key, {
      pendingMessage: `Sending ${key}...`,
      pendingDuration: KEY_PRESS_FEEDBACK_DURATION
    });
    if (sent) {
      setStatus(`Sent ${key}`, { duration: KEY_PRESS_FEEDBACK_DURATION, state: 'success' });
    }
  }
});
