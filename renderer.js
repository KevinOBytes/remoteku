// Use the exposed Roku API from preload script
const rokuAPI = window.rokuAPI;

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

// Configuration
const STATUS_DISPLAY_DURATION = 3000;
const KEY_PRESS_FEEDBACK_DURATION = 1000;
const PERMISSION_ERROR_CODES = new Set(['EACCES', 'EPERM']);
const STORAGE_KEY = 'remoteku:lastDevice';

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

async function sendRemoteKey(
  key,
  { pendingMessage = null, pendingDuration = KEY_PRESS_FEEDBACK_DURATION } = {}
) {
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
      .filter(item => item.family === 'IPv4' && !item.internal)
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
  setStatus('Discovering Roku devices...', { duration: 0, state: 'info' });
  setDiscoveryStatus('Scanning...');
  setLastScan(Date.now());
  deviceSelect.innerHTML = '<option value="">Searching...</option>';
  setTestResult('—');
  const savedDevice = loadLastDevice();

  try {
    const devices = await rokuAPI.discoverDevices();

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
  appsContainer.innerHTML = '<p>Loading apps...</p>';
  if (appsCount) {
    appsCount.textContent = 'Loading...';
  }

  try {
    const apps = await rokuAPI.getApps();

    if (apps.length === 0) {
      appsContainer.innerHTML = '<p>No apps found</p>';
      if (appsCount) {
        appsCount.textContent = '0 apps';
      }
      return [];
    }

    appsContainer.innerHTML = '';
    apps.forEach(app => {
      const tile = document.createElement('div');
      tile.className = 'app-tile';
      tile.innerHTML = `
        <div class="app-name">${app.name}</div>
        <div class="app-meta">v${app.version || '—'}</div>
      `;
      tile.title = `${app.name} (v${app.version})`;
      tile.dataset.appId = app.id;
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('role', 'button');

      const launchApp = async () => {
        setStatus(`Launching ${app.name}...`, { duration: 0, state: 'info' });
        const success = await rokuAPI.launchApp(app.id);
        if (success) {
          setStatus(`Launched ${app.name}`, { state: 'success' });
        } else {
          setStatus(`Failed to launch ${app.name}`, { state: 'error' });
        }
      };

      tile.addEventListener('click', launchApp);

      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          launchApp();
        }
      });

      appsContainer.appendChild(tile);
    });
    if (appsCount) {
      appsCount.textContent = `${apps.length} app${apps.length === 1 ? '' : 's'}`;
    }
    return apps;
  } catch (error) {
    console.error('Error loading apps:', error);
    appsContainer.innerHTML = '<p>Error loading apps</p>';
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

// Handle remote control buttons
document.querySelectorAll('.btn[data-key]').forEach(button => {
  button.addEventListener('click', async (e) => {
    const key = e.target.dataset.key;

    // Special handling for play/pause toggle
    if (e.target.id === 'play-pause-toggle') {
      const wasPlaying = isPlaying;
      const toggleKey = isPlaying ? 'Pause' : 'Play';
      isPlaying = !isPlaying;
      // Update button display
      e.target.textContent = isPlaying ? '⏸' : '▶';
      e.target.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      const sent = await sendRemoteKey(toggleKey, {
        pendingMessage: `Sending ${toggleKey}...`,
        pendingDuration: KEY_PRESS_FEEDBACK_DURATION
      });
      if (!sent) {
        isPlaying = wasPlaying;
        e.target.textContent = isPlaying ? '⏸' : '▶';
        e.target.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      }
      return;
    }

    await sendRemoteKey(key, {
      pendingMessage: `Sending ${key}...`,
      pendingDuration: KEY_PRESS_FEEDBACK_DURATION
    });
  });
});

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  updateCurrentDevice(null);
  updateAudioIndicators(null);
  setDiscoveryStatus('Idle');
  setLastScan(null);
  loadNetworkInfo();
  discoverDevices();
});

// Keyboard shortcuts
document.addEventListener('keydown', async (e) => {
  if (isTextEntryContext(e.target)) {
    return;
  }

  const keyMap = {
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Enter': 'Select',
    ' ': 'Play',
    'Backspace': 'Back',
    'Escape': 'Back'
  };

  const key = keyMap[e.key];
  if (key) {
    e.preventDefault();
    const sent = await sendRemoteKey(key, {
      pendingMessage: `Sending ${key}...`,
      pendingDuration: KEY_PRESS_FEEDBACK_DURATION
    });
    if (sent) {
      setStatus(`Sent ${key}`, { duration: KEY_PRESS_FEEDBACK_DURATION, state: 'success' });
    }
  }
});
