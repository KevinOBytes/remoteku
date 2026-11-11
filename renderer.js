// RemoteKu v2.0 Renderer Controller
const {
  DEFAULT_FAVORITES,
  normalizeHostInput,
  formatPlaybackProgress,
  resolveShortcutKey,
  togglePinnedAppId,
  mergePinnedApps,
  filterApps,
  getAppMonogram
} = window.RemoteKuLogic;

// DOM Elements
const deviceSelect = document.getElementById('device-select');
const headerDeviceSelect = document.getElementById('header-device-select');
const headerRescanBtn = document.getElementById('header-rescan-btn');
const refreshDevicesBtn = document.getElementById('refresh-devices');
const manualHostInput = document.getElementById('manual-host');
const manualConnectBtn = document.getElementById('manual-connect');
const openNetworkSettingsBtn = document.getElementById('open-network-settings');
const refreshAppsBtn = document.getElementById('refresh-apps');
const appsContainer = document.getElementById('apps-container');
const dockAppsContainer = document.getElementById('dock-apps-container');
const appsCount = document.getElementById('apps-count');
const dockAppsCount = document.getElementById('dock-apps-count');
const appsSearchInput = document.getElementById('apps-search-input');
const dockAppsSearchInput = document.getElementById('dock-apps-search');
const filterPills = document.querySelectorAll('.filter-pill');

const localIps = document.getElementById('local-ips');
const discoveryStatus = document.getElementById('discovery-status');
const lastScan = document.getElementById('last-scan');
const testConnectionBtn = document.getElementById('test-connection');
const testResult = document.getElementById('test-result');
const audioControl = document.getElementById('audio-control');
const volumeMute = document.getElementById('volume-mute');
const deviceModelOs = document.getElementById('device-model-os');
const devicePowerMode = document.getElementById('device-power-mode');

const statusMessage = document.getElementById('status-message');
const statusDot = document.getElementById('status-dot');
const currentDeviceLabel = document.getElementById('current-device');
const playPauseToggle = document.getElementById('play-pause-toggle');
const remoteAppShortcuts = document.getElementById('remote-app-shortcuts');

// Live TV Keyboard Elements
const rokuTextInput = document.getElementById('roku-text-input');
const rokuTextSendBtn = document.getElementById('roku-text-send');
const rokuLiveTypeToggle = document.getElementById('roku-live-type-toggle');
const rokuTextBackspaceBtn = document.getElementById('roku-text-backspace');
const rokuTextEnterBtn = document.getElementById('roku-text-enter');
const rokuTextSpaceBtn = document.getElementById('roku-text-space');
const rokuTextClearBtn = document.getElementById('roku-text-clear');

// Now Playing Elements
const nowPlayingAvatar = document.getElementById('now-playing-avatar');
const nowPlayingApp = document.getElementById('now-playing-app');
const nowPlayingState = document.getElementById('now-playing-state');
const nowPlayingProgressWrap = document.getElementById('now-playing-progress-wrap');
const nowPlayingProgressFill = document.getElementById('now-playing-progress-fill');
const nowPlayingTime = document.getElementById('now-playing-time');

// Header & Modal Elements
const soundToggleBtn = document.getElementById('sound-toggle');
const shortcutsHelpBtn = document.getElementById('shortcuts-help-btn');
const shortcutsModal = document.getElementById('shortcuts-modal');
const closeShortcutsModalBtn = document.getElementById('close-shortcuts-modal');
const miniModeToggleBtn = document.getElementById('mini-mode-toggle');

// Constants
const STATUS_DISPLAY_DURATION = 3000;
const KEY_PRESS_FEEDBACK_DURATION = 900;
const NOW_PLAYING_POLL_MS = 4000;
const HOLD_INITIAL_DELAY_MS = 360;
const HOLD_REPEAT_INTERVAL_MS = 145;
const PERMISSION_ERROR_CODES = new Set(['EACCES', 'EPERM']);
const LOCAL_NETWORK_BLOCKED_PATTERN = /EACCES|EPERM|EHOSTUNREACH|ENETUNREACH|Local network access blocked/i;
const LOCAL_NETWORK_HELP =
  'macOS is blocking RemoteKu from your local network. Open System Settings → Privacy & Security → Local Network and turn RemoteKu on.';

// Electron IPC strips error.code, so also inspect the serialized message.
function isLocalNetworkBlocked(error) {
  if (!error) return false;
  if (PERMISSION_ERROR_CODES.has(error.code)) return true;
  return LOCAL_NETWORK_BLOCKED_PATTERN.test(String(error.message || error));
}
const STORAGE_KEY_LAST_DEVICE = 'remoteku:lastDevice';
const STORAGE_KEY_PINNED_APPS = 'remoteku:pinnedApps';
const STORAGE_KEY_SOUND_FX = 'remoteku:soundEffects';
const DISCOVERY_OPTIONS = { fallbackScan: true, throwOnPermission: true };

// Runtime State
let isPlaying = false;
let isMiniMode = false;
let hasConnectedDevice = false;
let soundEffectsEnabled = true;
let statusTimeoutId = null;
let lastConnectError = null;
let nowPlayingIntervalId = null;
let installedApps = [];
let pinnedAppIds = [];
let currentFilterMode = 'all';
let appSearchQuery = '';
let audioCtx = null;
const iconDataCache = new Map();

// Synthesized subtle tactile click using Web Audio API
function playTactileClick(frequency = 190) {
  if (!soundEffectsEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(55, audioCtx.currentTime + 0.028);

    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.028);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.03);
  } catch (_error) {
    // Ignore audio context errors
  }
}

function loadPinnedAppIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PINNED_APPS);
    if (!raw) {
      return DEFAULT_FAVORITES.map((f) => String(f.id));
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((id) => String(id)).slice(0, 6);
    }
  } catch (_error) {
    // Fallback to defaults
  }
  return DEFAULT_FAVORITES.map((f) => String(f.id));
}

function savePinnedAppIds(ids) {
  pinnedAppIds = Array.isArray(ids) ? ids.map((id) => String(id)).slice(0, 6) : [];
  try {
    localStorage.setItem(STORAGE_KEY_PINNED_APPS, JSON.stringify(pinnedAppIds));
  } catch (_error) {
    // Ignore storage errors
  }
}

function loadSoundPreference() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SOUND_FX);
    if (raw !== null) {
      return raw === 'true';
    }
  } catch (_error) {
    // Ignore
  }
  return true;
}

function setSoundPreference(enabled) {
  soundEffectsEnabled = Boolean(enabled);
  if (soundToggleBtn) {
    soundToggleBtn.setAttribute('aria-pressed', soundEffectsEnabled ? 'true' : 'false');
    soundToggleBtn.title = soundEffectsEnabled ? 'Tactile Click Sound: On' : 'Tactile Click Sound: Off';
  }
  try {
    localStorage.setItem(STORAGE_KEY_SOUND_FX, String(soundEffectsEnabled));
  } catch (_error) {
    // Ignore
  }
  rokuAPI.updatePreferences?.({ soundEffects: soundEffectsEnabled }).catch(() => {});
}

function setStatus(message, { duration = STATUS_DISPLAY_DURATION, state = 'idle' } = {}) {
  if (statusMessage) {
    statusMessage.textContent = message;
  }
  if (statusDot) {
    statusDot.className = `status-dot ${state}`;
  }
  if (statusTimeoutId) {
    clearTimeout(statusTimeoutId);
  }
  if (duration > 0) {
    statusTimeoutId = setTimeout(() => {
      if (statusMessage) {
        statusMessage.textContent = hasConnectedDevice ? 'Ready' : 'Disconnected';
      }
      if (statusDot) {
        statusDot.className = hasConnectedDevice ? 'status-dot success' : 'status-dot idle';
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
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="6" y="4" width="4" height="16" rx="1"></rect>
        <rect x="14" y="4" width="4" height="16" rx="1"></rect>
      </svg>
    `;
  }

  return `
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  `;
}

function updatePlayPauseButton() {
  if (!playPauseToggle) return;
  playPauseToggle.innerHTML = playPauseIconMarkup(isPlaying);
  playPauseToggle.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  playPauseToggle.setAttribute('title', isPlaying ? 'Pause (Space or K)' : 'Play (Space or K)');
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

async function hydrateAppIcon(appId, containerEl, fallbackName) {
  if (!appId || !containerEl) return;
  if (iconDataCache.has(appId)) {
    const cached = iconDataCache.get(appId);
    if (cached) {
      const img = document.createElement('img');
      img.src = cached;
      img.alt = fallbackName || '';
      containerEl.replaceChildren(img);
    }
    return;
  }

  try {
    const dataUri = await rokuAPI.getAppIcon(appId);
    if (dataUri) {
      iconDataCache.set(appId, dataUri);
      const img = document.createElement('img');
      img.src = dataUri;
      img.alt = fallbackName || '';
      containerEl.replaceChildren(img);
    }
  } catch (_error) {
    // Keep monogram fallback
  }
}

function renderRemoteAppShortcuts(apps = installedApps) {
  if (!remoteAppShortcuts) return;
  remoteAppShortcuts.replaceChildren();

  const shortcuts = mergePinnedApps(pinnedAppIds, apps, DEFAULT_FAVORITES);
  shortcuts.forEach((shortcut) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn remote-app-btn';
    button.dataset.appId = shortcut.id;
    button.dataset.appName = shortcut.name;
    button.style.setProperty('--app-accent', shortcut.accent);
    button.style.setProperty('--app-shade', shortcut.shade || shortcut.accent);
    button.style.setProperty('--app-text', shortcut.text || '#ffffff');
    button.title = `Launch ${shortcut.name}`;
    button.setAttribute('aria-label', `Launch ${shortcut.name}`);

    const label = document.createElement('span');
    label.className = 'remote-app-label';
    label.textContent = shortcut.shortcutLabel || shortcut.name;

    button.appendChild(label);
    remoteAppShortcuts.appendChild(button);
  });
}

function buildAppTileElement(app) {
  const appIdStr = String(app.id ?? '');
  const isPinned = pinnedAppIds.includes(appIdStr);

  const tile = document.createElement('div');
  tile.className = `app-tile${isPinned ? ' is-pinned' : ''}`;
  tile.dataset.appId = appIdStr;
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('role', 'button');
  tile.title = `Launch ${app.name}${app.version ? ` (v${app.version})` : ''}`;

  const iconBox = document.createElement('div');
  iconBox.className = 'app-icon-box';
  iconBox.textContent = getAppMonogram(app.name);
  hydrateAppIcon(appIdStr, iconBox, app.name);

  const info = document.createElement('div');
  info.className = 'app-info';

  const name = document.createElement('div');
  name.className = 'app-name';
  name.textContent = app.name;

  const meta = document.createElement('div');
  meta.className = 'app-meta';
  meta.textContent = isPinned ? `★ Shortcut · v${app.version || '—'}` : `v${app.version || '—'}`;

  info.append(name, meta);

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = `app-pin-btn${isPinned ? ' pinned' : ''}`;
  pinBtn.textContent = '★';
  pinBtn.title = isPinned ? `Unpin ${app.name} from remote` : `Pin ${app.name} to remote shortcuts`;
  pinBtn.setAttribute('aria-label', pinBtn.title);

  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playTactileClick(240);
    const outcome = togglePinnedAppId(pinnedAppIds, appIdStr, 6);
    if (outcome.action === 'limit-reached') {
      setStatus('Max 6 shortcuts pinned — unpin one first.', { state: 'warning' });
      return;
    }
    savePinnedAppIds(outcome.pinnedIds);
    renderAppGrids();
    renderRemoteAppShortcuts(installedApps);
    setStatus(
      outcome.action === 'pinned' ? `Pinned ${app.name} to remote` : `Unpinned ${app.name}`,
      { state: 'info', duration: 2000 }
    );
  });

  const launchTileApp = async () => {
    playTactileClick(210);
    await launchRokuApp(appIdStr, app.name, tile);
  };

  tile.addEventListener('click', launchTileApp);
  tile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      launchTileApp();
    }
  });

  tile.append(iconBox, info, pinBtn);
  return tile;
}

function renderAppGrids() {
  const filtered = filterApps(installedApps, {
    query: appSearchQuery,
    pinnedIds: pinnedAppIds,
    filterMode: currentFilterMode
  });

  const countLabel = `${filtered.length} channel${filtered.length === 1 ? '' : 's'}`;
  if (appsCount) appsCount.textContent = countLabel;
  if (dockAppsCount) dockAppsCount.textContent = countLabel;

  const populateContainer = (container) => {
    if (!container) return;
    container.replaceChildren();
    if (installedApps.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No channels loaded yet.';
      container.appendChild(empty);
      return;
    }
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No channels match your filter.';
      container.appendChild(empty);
      return;
    }
    filtered.forEach((app) => {
      container.appendChild(buildAppTileElement(app));
    });
  };

  populateContainer(appsContainer);
  populateContainer(dockAppsContainer);
}

async function launchRokuApp(appId, appName, sourceElement) {
  if (!appId) return;
  triggerVisualFeedback(sourceElement);
  setStatus(`Launching ${appName}...`, { duration: 0, state: 'info' });

  try {
    const success = await rokuAPI.launchApp(appId);
    if (success) {
      setStatus(`Launched ${appName}`, { state: 'success' });
      setTimeout(refreshNowPlaying, 900);
    } else {
      setStatus(`Failed to launch ${appName}`, { state: 'error' });
    }
  } catch (error) {
    const isNoDeviceSelected = error?.message === 'No device selected';
    setStatus(
      isNoDeviceSelected ? 'Connect to a Roku first.' : `Failed to launch ${appName}`,
      { state: isNoDeviceSelected ? 'warning' : 'error' }
    );
  }
}

async function sendRemoteKey(
  key,
  { pendingMessage = null, pendingDuration = KEY_PRESS_FEEDBACK_DURATION } = {}
) {
  const keyElement = document.querySelector(`[data-key="${key}"]`);
  triggerVisualFeedback(keyElement);
  playTactileClick();

  if (pendingMessage) {
    setStatus(pendingMessage, { duration: pendingDuration, state: 'info' });
  }

  try {
    const success = await rokuAPI.sendKey(key);
    if (!success) {
      setStatus(`Failed to send ${key}`, { state: 'error' });
      return false;
    }
    if (key === 'Play' || key === 'Home' || key === 'Back') {
      setTimeout(refreshNowPlaying, 600);
    }
    return true;
  } catch (error) {
    const isNoDeviceSelected = error?.message === 'No device selected';
    setStatus(
      isNoDeviceSelected ? 'No Roku connected.' : `Error sending ${key}`,
      { state: isNoDeviceSelected ? 'warning' : 'error' }
    );
    return false;
  }
}

async function refreshNowPlaying() {
  if (!rokuAPI.getNowPlaying) return;
  try {
    const current = await rokuAPI.getCurrentDevice();
    if (!current) {
      if (nowPlayingApp) nowPlayingApp.textContent = 'Not Connected';
      if (nowPlayingState) {
        nowPlayingState.textContent = 'OFFLINE';
        nowPlayingState.className = 'np-badge idle';
      }
      nowPlayingProgressWrap?.classList.add('hidden');
      return;
    }

    const telemetry = await rokuAPI.getNowPlaying();
    const activeApp = telemetry?.activeApp;
    const screensaver = telemetry?.screensaver;
    const media = telemetry?.media;

    const channelName = screensaver
      ? `${activeApp?.name || 'Roku'} · Screensaver`
      : activeApp?.name || media?.pluginName || 'Roku Home';

    if (nowPlayingApp) {
      nowPlayingApp.textContent = channelName;
    }

    if (nowPlayingAvatar) {
      if (activeApp?.id) {
        hydrateAppIcon(String(activeApp.id), nowPlayingAvatar, channelName);
      } else {
        nowPlayingAvatar.textContent = getAppMonogram(channelName);
      }
    }

    const mediaState = String(media?.state || 'none').toLowerCase();
    if (mediaState === 'play' || mediaState === 'pause' || mediaState === 'buffer') {
      isPlaying = mediaState === 'play';
      updatePlayPauseButton();

      if (nowPlayingState) {
        nowPlayingState.textContent = mediaState === 'play' ? 'PLAYING' : mediaState === 'pause' ? 'PAUSED' : 'BUFFERING';
        nowPlayingState.className = `np-badge ${mediaState === 'play' ? 'play' : 'pause'}`;
      }

      if (typeof media?.positionMs === 'number') {
        const progress = formatPlaybackProgress(media.positionMs, media.durationMs);
        nowPlayingProgressWrap?.classList.remove('hidden');
        if (nowPlayingProgressFill) {
          nowPlayingProgressFill.style.width = `${progress.percent}%`;
        }
        if (nowPlayingTime) {
          nowPlayingTime.textContent = media.durationMs
            ? `${progress.elapsedText} / ${progress.durationText}`
            : progress.elapsedText;
        }
      } else {
        nowPlayingProgressWrap?.classList.add('hidden');
      }
    } else {
      if (nowPlayingState) {
        nowPlayingState.textContent = screensaver ? 'SCREENSAVER' : 'ACTIVE';
        nowPlayingState.className = 'np-badge idle';
      }
      nowPlayingProgressWrap?.classList.add('hidden');
    }
  } catch (_error) {
    // Ignore transient telemetry errors
  }
}

function updateCurrentDevice(device) {
  hasConnectedDevice = Boolean(device && device.host);
  if (!currentDeviceLabel) return;
  if (!device) {
    currentDeviceLabel.textContent = 'Not connected';
    return;
  }
  const friendly = device.friendlyName || 'Roku Device';
  const ip = device.ip || device.host || '';
  currentDeviceLabel.textContent = ip ? `${friendly} · ${ip}` : friendly;
}

function saveLastDevice(device) {
  if (!device || !device.host) return;
  const payload = {
    host: device.host,
    ip: device.ip,
    friendlyName: device.friendlyName
  };
  try {
    localStorage.setItem(STORAGE_KEY_LAST_DEVICE, JSON.stringify(payload));
  } catch (_error) {
    // Ignore
  }
}

function loadLastDevice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_DEVICE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.host ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function renderDeviceOptions(devices, selectedHost) {
  const populateSelect = (selectEl) => {
    if (!selectEl) return;
    selectEl.replaceChildren();
    if (!Array.isArray(devices) || devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No Roku found';
      selectEl.appendChild(opt);
      return;
    }
    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${device.friendlyName || 'Roku Device'} (${device.ip || device.host})`;
      selectEl.appendChild(option);
    });
    if (selectedHost) {
      const selectedIndex = devices.findIndex((device) => device.host === selectedHost);
      if (selectedIndex >= 0) {
        selectEl.value = String(selectedIndex);
      }
    }
  };

  populateSelect(deviceSelect);
  populateSelect(headerDeviceSelect);
}

function updateAudioIndicators(info) {
  setVolumeControlAvailability(info?.supportsAudioVolumeControl);

  if (audioControl) {
    const support = info?.supportsAudioVolumeControl;
    audioControl.textContent = support === true ? 'Supported' : support === false ? 'Unsupported' : 'Standard ECP';
  }

  if (volumeMute) {
    const volume = typeof info?.volume === 'number' ? info.volume : null;
    const muted = typeof info?.muted === 'boolean' ? info.muted : null;
    if (volume === null && muted === null) {
      volumeMute.textContent = '—';
    } else {
      const volumeText = volume !== null ? `Vol ${volume}` : 'Vol —';
      const muteText = muted === null ? '' : muted ? ' · Muted' : ' · Unmuted';
      volumeMute.textContent = `${volumeText}${muteText}`;
    }
  }

  if (deviceModelOs) {
    if (!info) {
      deviceModelOs.textContent = '—';
    } else {
      const model = info.modelName || 'Roku';
      const osVer = info.softwareVersion ? `OS ${info.softwareVersion}` : '';
      deviceModelOs.textContent = osVer ? `${model} · ${osVer}` : model;
    }
  }

  if (devicePowerMode) {
    if (!info) {
      devicePowerMode.textContent = '—';
    } else {
      const pwr = info.powerMode || 'Ready';
      const net = info.networkType ? info.networkType.toUpperCase() : 'LAN';
      devicePowerMode.textContent = `${pwr} · ${net}`;
    }
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
  } catch (_error) {
    updateAudioIndicators(null);
  }
}

async function loadNetworkInfo() {
  if (!localIps) return;
  try {
    const interfaces = await rokuAPI.getNetworkInfo();
    const physical = interfaces.filter(
      (item) => (item.family === 'IPv4' || item.family === 4) && !item.internal && !item.virtual
    );
    const chosen = physical.length > 0
      ? physical
      : interfaces.filter((item) => (item.family === 'IPv4' || item.family === 4) && !item.internal);

    localIps.textContent = chosen.length > 0
      ? chosen.map((item) => `${item.name}: ${item.address}`).join(', ')
      : 'No external IPv4 interfaces detected';
  } catch (_error) {
    localIps.textContent = 'Unable to read network interfaces';
  }
}

async function connectToHost(hostInput, { remember = true, announce = true, silentFail = false } = {}) {
  const url = normalizeHostInput(hostInput);
  if (!url) {
    if (!silentFail) {
      setStatus('Enter a valid IP or host (e.g. 192.168.1.20)', { state: 'warning' });
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
    lastConnectError = null;
    await Promise.all([loadApps(), refreshNowPlaying()]);
    return true;
  } catch (error) {
    updateAudioIndicators(null);
    lastConnectError = error;
    if (!silentFail) {
      setStatus(
        isLocalNetworkBlocked(error)
          ? LOCAL_NETWORK_HELP
          : 'Connection failed. Verify Roku IP and network.',
        { state: 'error', duration: isLocalNetworkBlocked(error) ? 0 : STATUS_DISPLAY_DURATION }
      );
    }
    return false;
  }
}

async function discoverDevices({ preferExistingConnection = false } = {}) {
  if (!preferExistingConnection) {
    setStatus('Scanning local network for Roku devices…', { duration: 0, state: 'info' });
  }
  if (discoveryStatus) discoveryStatus.textContent = 'Scanning (SSDP + LAN)…';
  if (lastScan) lastScan.textContent = new Date().toLocaleTimeString();

  const savedDevice = loadLastDevice();
  const previousDevice = await rokuAPI.getCurrentDevice();

  try {
    const devices = await rokuAPI.discoverDevices({
      ...DISCOVERY_OPTIONS,
      keepCurrentOnEmpty: Boolean(preferExistingConnection || previousDevice?.host)
    });
    const current = (await rokuAPI.getCurrentDevice()) || previousDevice;

    if (devices.length === 0) {
      if (current?.host) {
        await rokuAPI.addDevice(current);
        await rokuAPI.setDevice(current);
        const restoredList = await rokuAPI.getDevices();
        renderDeviceOptions(restoredList, current.host);
        updateCurrentDevice(current);
        if (discoveryStatus) discoveryStatus.textContent = 'Connected (Saved IP)';
        return;
      }

      if (savedDevice?.host) {
        const reconnected = await connectToHost(savedDevice.host, {
          remember: true,
          announce: !preferExistingConnection,
          silentFail: true
        });
        if (reconnected) {
          if (discoveryStatus) discoveryStatus.textContent = 'Connected (Saved IP)';
          return;
        }
      }

      renderDeviceOptions([], null);
      updateCurrentDevice(null);
      updateAudioIndicators(null);
      const savedHostBlocked = Boolean(savedDevice?.host) && isLocalNetworkBlocked(lastConnectError);
      if (discoveryStatus) discoveryStatus.textContent = savedHostBlocked ? 'Blocked' : 'None found';
      setStatus(
        savedHostBlocked
          ? LOCAL_NETWORK_HELP
          : 'No Roku found via scan. Enter IP manually or check Local Network access.',
        { state: savedHostBlocked ? 'error' : 'warning', duration: savedHostBlocked ? 0 : STATUS_DISPLAY_DURATION }
      );
      return;
    }

    const activeHost = current?.host || savedDevice?.host || devices[0]?.host;
    renderDeviceOptions(devices, activeHost);
    if (discoveryStatus) discoveryStatus.textContent = `Found ${devices.length}`;

    const selectedDevice = devices.find((d) => d.host === activeHost) || devices[0];
    if (selectedDevice) {
      await rokuAPI.setDevice(selectedDevice);
      updateCurrentDevice(selectedDevice);
      saveLastDevice(selectedDevice);
      refreshAudioIndicators(selectedDevice);
      setStatus(`Connected to ${selectedDevice.friendlyName}`, { state: 'success' });
      await Promise.all([loadApps(), refreshNowPlaying()]);
    }
  } catch (error) {
    if (previousDevice?.host) {
      await rokuAPI.addDevice(previousDevice);
      await rokuAPI.setDevice(previousDevice);
      const restoredList = await rokuAPI.getDevices();
      renderDeviceOptions(restoredList, previousDevice.host);
      updateCurrentDevice(previousDevice);
      if (discoveryStatus) discoveryStatus.textContent = 'Connected (Saved IP)';
      return;
    }
    const permissionBlocked = isLocalNetworkBlocked(error);
    const statusText = permissionBlocked ? LOCAL_NETWORK_HELP : 'Error discovering devices';
    if (discoveryStatus) discoveryStatus.textContent = permissionBlocked ? 'Blocked' : 'Error';
    setStatus(statusText, { state: 'error', duration: permissionBlocked ? 0 : STATUS_DISPLAY_DURATION });
  }
}

async function loadApps() {
  if (appsCount) appsCount.textContent = 'Loading…';
  if (dockAppsCount) dockAppsCount.textContent = 'Loading…';

  try {
    const apps = await rokuAPI.getApps();
    installedApps = Array.isArray(apps) ? apps : [];
    renderAppGrids();
    renderRemoteAppShortcuts(installedApps);
    return installedApps;
  } catch (_error) {
    installedApps = [];
    renderAppGrids();
    renderRemoteAppShortcuts([]);
    return [];
  }
}

async function switchDeviceByIndex(index) {
  const devices = await rokuAPI.getDevices();
  const target = devices[index];
  if (!target) return;

  await rokuAPI.setDevice(target);
  renderDeviceOptions(devices, target.host);
  updateCurrentDevice(target);
  saveLastDevice(target);
  setStatus(`Switched to ${target.friendlyName}`, { state: 'info' });
  refreshAudioIndicators(target);
  await Promise.all([loadApps(), refreshNowPlaying()]);
}

deviceSelect?.addEventListener('change', (e) => {
  const index = Number.parseInt(e.target.value, 10);
  if (Number.isInteger(index)) {
    switchDeviceByIndex(index);
  }
});

headerDeviceSelect?.addEventListener('change', (e) => {
  const index = Number.parseInt(e.target.value, 10);
  if (Number.isInteger(index)) {
    switchDeviceByIndex(index);
  }
});

const triggerRescan = () => {
  loadNetworkInfo();
  discoverDevices({ preferExistingConnection: false });
};

refreshDevicesBtn?.addEventListener('click', triggerRescan);
headerRescanBtn?.addEventListener('click', triggerRescan);

manualConnectBtn?.addEventListener('click', async () => {
  await connectToHost(manualHostInput.value, { remember: true, announce: true });
});

manualHostInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    manualConnectBtn.click();
  }
});

openNetworkSettingsBtn?.addEventListener('click', () => {
  rokuAPI.openNetworkSettings?.();
});

testConnectionBtn?.addEventListener('click', async () => {
  const current = await rokuAPI.getCurrentDevice();
  if (!current?.host) {
    if (testResult) testResult.textContent = 'No device selected';
    setStatus('Select a device to test.', { state: 'warning' });
    return;
  }

  if (testResult) testResult.textContent = 'Testing…';
  setStatus('Testing device reachability…', { duration: 0, state: 'info' });

  try {
    const start = performance.now();
    const info = await rokuAPI.probeDevice(current.host);
    const rttMs = Math.round(performance.now() - start);
    updateAudioIndicators(info);
    if (testResult) {
      testResult.textContent = `OK (${rttMs} ms) · ${info.modelName || 'Roku'} · ${info.serialNumber || '—'}`;
    }
    setStatus(`Reachable (${rttMs} ms)`, { state: 'success' });
  } catch (_error) {
    if (testResult) testResult.textContent = 'Unreachable';
    setStatus('Device unreachable', { state: 'error' });
  }
});

refreshAppsBtn?.addEventListener('click', () => {
  loadApps();
});

// App Search & Filter Sync
const handleAppSearchInput = (value, sourceEl) => {
  appSearchQuery = value;
  if (appsSearchInput && sourceEl !== appsSearchInput) {
    appsSearchInput.value = value;
  }
  if (dockAppsSearchInput && sourceEl !== dockAppsSearchInput) {
    dockAppsSearchInput.value = value;
  }
  renderAppGrids();
};

appsSearchInput?.addEventListener('input', (e) => handleAppSearchInput(e.target.value, appsSearchInput));
dockAppsSearchInput?.addEventListener('input', (e) => handleAppSearchInput(e.target.value, dockAppsSearchInput));

filterPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    currentFilterMode = pill.dataset.filter || 'all';
    filterPills.forEach((p) => p.classList.toggle('active', p === pill));
    renderAppGrids();
  });
});

// Live TV Keyboard Entry
async function sendFullTextBoxToRoku() {
  const text = rokuTextInput?.value || '';
  if (!text) {
    setStatus('Type text to send to Roku first.', { state: 'warning' });
    rokuTextInput?.focus();
    return;
  }
  if (rokuLiveTypeToggle?.checked && rokuTextInput?.dataset.liveStreamed === 'true') {
    await sendRemoteKey('Enter', { pendingMessage: 'Sent Enter' });
    if (rokuTextInput) {
      rokuTextInput.value = '';
      rokuTextInput.dataset.liveStreamed = 'false';
    }
    return;
  }
  setStatus(`Sending "${text}"…`, { duration: 0, state: 'info' });
  try {
    const ok = await rokuAPI.sendText(text);
    if (ok) {
      setStatus(`Sent "${text}"`, { state: 'success' });
      if (rokuTextInput) {
        rokuTextInput.value = '';
        rokuTextInput.dataset.liveStreamed = 'false';
      }
    } else {
      setStatus('Failed to send text to Roku', { state: 'error' });
    }
  } catch (_error) {
    setStatus('Connect to a Roku before sending text.', { state: 'warning' });
  }
}

rokuTextSendBtn?.addEventListener('click', sendFullTextBoxToRoku);

rokuTextInput?.addEventListener('paste', (e) => {
  if (!rokuLiveTypeToggle?.checked) {
    if (rokuTextInput) {
      rokuTextInput.dataset.liveStreamed = 'false';
    }
    return;
  }
  const pasted = e.clipboardData?.getData('text') || '';
  if (pasted) {
    if (rokuTextInput) {
      rokuTextInput.dataset.liveStreamed = 'true';
    }
    rokuAPI.sendText(pasted).catch(() => {});
  }
});

rokuTextInput?.addEventListener('keydown', async (e) => {
  const isLive = Boolean(rokuLiveTypeToggle?.checked);
  if (e.key === 'Escape') {
    rokuTextInput.blur();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (isLive) {
      await sendRemoteKey('Enter', { pendingMessage: 'Sent Enter' });
      rokuTextInput.value = '';
      rokuTextInput.dataset.liveStreamed = 'false';
    } else {
      await sendFullTextBoxToRoku();
    }
    return;
  }

  if (!isLive) {
    rokuTextInput.dataset.liveStreamed = 'false';
    return;
  }

  if (e.key === 'Backspace') {
    await sendRemoteKey('Backspace', { pendingMessage: 'Sent Backspace', pendingDuration: 600 });
    return;
  }

  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    playTactileClick(230);
    rokuTextInput.dataset.liveStreamed = 'true';
    rokuAPI.sendText(e.key, { charDelayMs: 0 }).catch(() => {});
  }
});

rokuTextBackspaceBtn?.addEventListener('click', () => {
  sendRemoteKey('Backspace', { pendingMessage: 'Sent Backspace' });
});

rokuTextEnterBtn?.addEventListener('click', () => {
  sendRemoteKey('Select', { pendingMessage: 'Sent Submit / OK' });
});

rokuTextSpaceBtn?.addEventListener('click', () => {
  rokuAPI.sendText(' ').catch(() => {});
  setStatus('Sent Space', { duration: 900, state: 'info' });
});

rokuTextClearBtn?.addEventListener('click', () => {
  if (rokuTextInput) {
    rokuTextInput.value = '';
    rokuTextInput.focus();
  }
});

// Tabs Navigation
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

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

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    activateTab(btn.dataset.tab || btn.dataset.target);
  });
});

// Remote Control Buttons + Hold-to-Repeat Support
let holdTimeoutId = null;
let holdIntervalId = null;
let holdTriggeredRepeat = false;

function stopHoldRepeat() {
  if (holdTimeoutId) {
    clearTimeout(holdTimeoutId);
    holdTimeoutId = null;
  }
  if (holdIntervalId) {
    clearInterval(holdIntervalId);
    holdIntervalId = null;
  }
}

document.querySelectorAll('[data-key]').forEach((button) => {
  const key = button.dataset.key;
  const isRepeatable = button.dataset.repeatable === 'true';

  if (isRepeatable) {
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      stopHoldRepeat();
      holdTriggeredRepeat = false;
      holdTimeoutId = setTimeout(() => {
        holdTriggeredRepeat = true;
        sendRemoteKey(key, { pendingMessage: `Holding ${key}…`, pendingDuration: 600 });
        holdIntervalId = setInterval(() => {
          sendRemoteKey(key, { pendingMessage: `Holding ${key}…`, pendingDuration: 600 });
        }, HOLD_REPEAT_INTERVAL_MS);
      }, HOLD_INITIAL_DELAY_MS);
    });

    ['pointerup', 'pointerleave', 'pointercancel'].forEach((evtName) => {
      button.addEventListener(evtName, stopHoldRepeat);
    });
  }

  button.addEventListener('click', async (e) => {
    if (holdTriggeredRepeat) {
      holdTriggeredRepeat = false;
      return;
    }
    const targetKey = e.currentTarget.dataset.key;
    if (!targetKey) return;

    if (e.currentTarget.id === 'play-pause-toggle') {
      const wasPlaying = isPlaying;
      isPlaying = !isPlaying;
      updatePlayPauseButton();
      const sent = await sendRemoteKey('Play', {
        pendingMessage: 'Sending Play/Pause…',
        pendingDuration: KEY_PRESS_FEEDBACK_DURATION
      });
      if (!sent) {
        isPlaying = wasPlaying;
        updatePlayPauseButton();
      }
      return;
    }

    await sendRemoteKey(targetKey, {
      pendingMessage: `Sending ${targetKey}…`,
      pendingDuration: KEY_PRESS_FEEDBACK_DURATION
    });
  });
});

remoteAppShortcuts?.addEventListener('click', async (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const button = target?.closest('.remote-app-btn');
  if (!button) return;

  playTactileClick(215);
  const appId = button.dataset.appId;
  const appName = button.dataset.appName || button.textContent?.trim() || 'channel';
  await launchRokuApp(appId, appName, button);
});

// Header Actions & Modals
function setMiniModeState(nextMini, notifyMain = true) {
  isMiniMode = Boolean(nextMini);
  if (isMiniMode) {
    activateTab('tab-remote');
  }
  document.body.classList.toggle('mini-mode', isMiniMode);
  if (notifyMain) {
    rokuAPI.toggleMiniMode?.(isMiniMode);
  }
}

miniModeToggleBtn?.addEventListener('click', () => {
  setMiniModeState(!isMiniMode, true);
});

soundToggleBtn?.addEventListener('click', () => {
  setSoundPreference(!soundEffectsEnabled);
  if (soundEffectsEnabled) {
    playTactileClick(260);
  }
});

function toggleShortcutsModal(forceOpen) {
  if (!shortcutsModal) return;
  const isHidden = shortcutsModal.classList.contains('hidden');
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : isHidden;
  shortcutsModal.classList.toggle('hidden', !shouldOpen);
}

shortcutsHelpBtn?.addEventListener('click', () => toggleShortcutsModal());
closeShortcutsModalBtn?.addEventListener('click', () => toggleShortcutsModal(false));
shortcutsModal?.addEventListener('click', (e) => {
  if (e.target === shortcutsModal) {
    toggleShortcutsModal(false);
  }
});

function handleUiAction(action, value) {
  if (action === 'focus-keyboard') {
    if (isMiniMode) setMiniModeState(false, true);
    activateTab('tab-remote');
    rokuTextInput?.focus();
    rokuTextInput?.select();
  } else if (action === 'focus-apps-search') {
    if (isMiniMode) setMiniModeState(false, true);
    const onAppsTab = document.getElementById('tab-apps')?.classList.contains('active');
    const targetInput = onAppsTab ? appsSearchInput : dockAppsSearchInput;
    targetInput?.focus();
    targetInput?.select();
  } else if (action === 'rescan') {
    triggerRescan();
  } else if (action === 'toggle-mini-mode') {
    setMiniModeState(!isMiniMode, true);
  } else if (action === 'set-mini-mode') {
    setMiniModeState(Boolean(value), false);
  } else if (action === 'toggle-shortcuts-modal') {
    toggleShortcutsModal();
  }
}

// Keyboard Shortcuts
document.addEventListener('keydown', async (e) => {
  if (!shortcutsModal?.classList.contains('hidden') && e.key === 'Escape') {
    e.preventDefault();
    toggleShortcutsModal(false);
    return;
  }

  if (isTextEntryContext(e.target)) {
    // Still allow Cmd+K / Cmd+F / Cmd+Shift+M while inside inputs
    if (e.metaKey || e.ctrlKey) {
      const resolved = resolveShortcutKey(e);
      if (resolved?.type === 'ui') {
        e.preventDefault();
        handleUiAction(resolved.action);
      }
    }
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

  if (isInteractiveFocused && (e.key === 'Enter' || e.key === ' ')) {
    return;
  }

  if (active && active.tagName === 'SELECT' && e.key.startsWith('Arrow')) {
    return;
  }

  if (active && active.classList.contains('tab-btn') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
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

  const resolved = resolveShortcutKey(e);
  if (!resolved) return;

  if (resolved.type === 'ui') {
    e.preventDefault();
    handleUiAction(resolved.action);
    return;
  }

  if (resolved.type === 'roku') {
    e.preventDefault();
    if (resolved.isPlayToggle) {
      playPauseToggle?.click();
      return;
    }
    const sent = await sendRemoteKey(resolved.key, {
      pendingMessage: `Sending ${resolved.key}…`,
      pendingDuration: KEY_PRESS_FEEDBACK_DURATION
    });
    if (sent) {
      setStatus(`Sent ${resolved.key}`, { duration: KEY_PRESS_FEEDBACK_DURATION, state: 'success' });
    }
  }
});

// Subscribe to Main Process Events (Menu Bar Tray, Touch Bar, System Resume)
rokuAPI.onMenuAction?.((payload) => {
  if (payload?.action) {
    handleUiAction(payload.action, payload.value);
  }
});

rokuAPI.onDeviceChanged?.(async (device) => {
  if (!device) return;
  const devices = await rokuAPI.getDevices();
  renderDeviceOptions(devices, device.host);
  updateCurrentDevice(device);
  saveLastDevice(device);
  refreshAudioIndicators(device);
  await Promise.all([loadApps(), refreshNowPlaying()]);
});

rokuAPI.onSystemResume?.(async () => {
  const saved = loadLastDevice();
  if (saved?.host) {
    await connectToHost(saved.host, { remember: true, announce: false, silentFail: true });
  }
  refreshNowPlaying();
});

// Startup Initialization (Instant Parallel Reconnect + Background SSDP Scan)
window.addEventListener('DOMContentLoaded', async () => {
  pinnedAppIds = loadPinnedAppIds();
  setSoundPreference(loadSoundPreference());
  updateCurrentDevice(null);
  updateAudioIndicators(null);
  updatePlayPauseButton();
  renderRemoteAppShortcuts([]);
  loadNetworkInfo();

  let mainSavedDevice = null;
  try {
    const winState = await rokuAPI.getWindowState?.();
    if (winState?.isMiniMode) {
      setMiniModeState(true, false);
    }
    if (winState?.lastDevice?.host) {
      mainSavedDevice = winState.lastDevice;
    }
  } catch (_error) {
    // Ignore
  }

  // Instant reconnect to last known Roku in <150ms before waiting for SSDP multicast timeout
  const savedDevice = loadLastDevice() || mainSavedDevice;
  if (savedDevice?.host) {
    saveLastDevice(savedDevice);
    connectToHost(savedDevice.host, {
      remember: true,
      announce: true,
      silentFail: true
    }).then((reconnected) => {
      if (reconnected) {
        discoverDevices({ preferExistingConnection: true });
      } else {
        discoverDevices({ preferExistingConnection: false });
      }
    });
  } else {
    discoverDevices({ preferExistingConnection: false });
  }

  if (nowPlayingIntervalId) {
    clearInterval(nowPlayingIntervalId);
  }
  nowPlayingIntervalId = setInterval(() => {
    if (!document.hidden) {
      refreshNowPlaying();
    }
  }, NOW_PLAYING_POLL_MS);
});
