// Use the exposed Roku API from preload script
const rokuAPI = window.rokuAPI;

// DOM elements
const deviceSelect = document.getElementById('device-select');
const refreshDevicesBtn = document.getElementById('refresh-devices');
const refreshAppsBtn = document.getElementById('refresh-apps');
const appsContainer = document.getElementById('apps-container');
const statusMessage = document.getElementById('status-message');
const playPauseToggle = document.getElementById('play-pause-toggle');

// State
let isPlaying = false;

// Configuration
const STATUS_DISPLAY_DURATION = 3000;

// Status message helper
function showStatus(message, duration = STATUS_DISPLAY_DURATION) {
  statusMessage.textContent = message;
  if (duration > 0) {
    setTimeout(() => {
      statusMessage.textContent = 'Ready';
    }, duration);
  }
}

// Discover devices on load
async function discoverDevices() {
  showStatus('Discovering Roku devices...', 0);
  deviceSelect.innerHTML = '<option value="">Searching...</option>';
  
  try {
    const devices = await rokuAPI.discoverDevices();
    
    if (devices.length === 0) {
      deviceSelect.innerHTML = '<option value="">No devices found</option>';
      showStatus('No Roku devices found');
      return;
    }
    
    deviceSelect.innerHTML = '';
    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${device.friendlyName} (${device.ip})`;
      deviceSelect.appendChild(option);
    });
    
    // Select first device by default
    deviceSelect.value = '0';
    rokuAPI.setDevice(devices[0]);
    showStatus(`Connected to ${devices[0].friendlyName}`);
    
    // Load apps for the first device
    loadApps();
  } catch (error) {
    console.error('Error discovering devices:', error);
    deviceSelect.innerHTML = '<option value="">Error discovering devices</option>';
    showStatus('Error discovering devices');
  }
}

// Handle device selection change
deviceSelect.addEventListener('change', (e) => {
  const index = parseInt(e.target.value);
  const devices = rokuAPI.getDevices();
  
  if (devices[index]) {
    rokuAPI.setDevice(devices[index]);
    showStatus(`Switched to ${devices[index].friendlyName}`);
    loadApps();
  }
});

// Refresh devices button
refreshDevicesBtn.addEventListener('click', () => {
  discoverDevices();
});

// Load apps from current device
async function loadApps() {
  appsContainer.innerHTML = '<p>Loading apps...</p>';
  
  try {
    const apps = await rokuAPI.getApps();
    
    if (apps.length === 0) {
      appsContainer.innerHTML = '<p>No apps found</p>';
      return;
    }
    
    appsContainer.innerHTML = '';
    apps.forEach(app => {
      const tile = document.createElement('div');
      tile.className = 'app-tile';
      tile.textContent = app.name;
      tile.title = `${app.name} (v${app.version})`;
      tile.dataset.appId = app.id;
      
      tile.addEventListener('click', async () => {
        showStatus(`Launching ${app.name}...`, 0);
        const success = await rokuAPI.launchApp(app.id);
        if (success) {
          showStatus(`Launched ${app.name}`);
        } else {
          showStatus(`Failed to launch ${app.name}`);
        }
      });
      
      appsContainer.appendChild(tile);
    });
  } catch (error) {
    console.error('Error loading apps:', error);
    appsContainer.innerHTML = '<p>Error loading apps</p>';
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
      const toggleKey = isPlaying ? 'Pause' : 'Play';
      isPlaying = !isPlaying;
      showStatus(`Sending ${toggleKey}...`, 1000);
      await rokuAPI.sendKey(toggleKey);
      return;
    }
    
    showStatus(`Sending ${key}...`, 1000);
    const success = await rokuAPI.sendKey(key);
    
    if (!success) {
      showStatus(`Failed to send ${key}`);
    }
  });
});

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  discoverDevices();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const keyMap = {
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Enter': 'Select',
    ' ': 'Play',
    'Backspace': 'Back',
    'Home': 'Home',
    'Escape': 'Home'
  };
  
  const key = keyMap[e.key];
  if (key) {
    e.preventDefault();
    rokuAPI.sendKey(key);
    showStatus(`Sent ${key}`, 1000);
  }
});
