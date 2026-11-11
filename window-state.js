const fs = require('fs');
const path = require('path');

class WindowStateManager {
  static DEFAULT_NORMAL_BOUNDS = {
    width: 1080,
    height: 840,
    x: undefined,
    y: undefined
  };

  static DEFAULT_MINI_BOUNDS = {
    width: 340,
    height: 780,
    x: undefined,
    y: undefined
  };

  constructor(filePath) {
    this.filePath = filePath;
    this.state = WindowStateManager.createDefaultState();
  }

  static createDefaultState() {
    return {
      normalBounds: { ...WindowStateManager.DEFAULT_NORMAL_BOUNDS },
      miniBounds: { ...WindowStateManager.DEFAULT_MINI_BOUNDS },
      isMiniMode: false,
      alwaysOnTop: false,
      closeToTray: true,
      soundEffects: true,
      lastDevice: null
    };
  }

  static sanitizeBounds(raw, defaults, minWidth, minHeight) {
    if (!raw || typeof raw !== 'object') {
      return { ...defaults };
    }
    const width = Number.isFinite(raw.width) && raw.width >= minWidth ? Math.round(raw.width) : defaults.width;
    const height = Number.isFinite(raw.height) && raw.height >= minHeight ? Math.round(raw.height) : defaults.height;
    const x = Number.isFinite(raw.x) ? Math.round(raw.x) : defaults.x;
    const y = Number.isFinite(raw.y) ? Math.round(raw.y) : defaults.y;
    return { width, height, x, y };
  }

  load() {
    try {
      if (this.filePath && fs.existsSync(this.filePath)) {
        const rawText = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === 'object') {
          this.state = {
            normalBounds: WindowStateManager.sanitizeBounds(
              parsed.normalBounds,
              WindowStateManager.DEFAULT_NORMAL_BOUNDS,
              760,
              680
            ),
            miniBounds: WindowStateManager.sanitizeBounds(
              parsed.miniBounds,
              WindowStateManager.DEFAULT_MINI_BOUNDS,
              320,
              640
            ),
            isMiniMode: Boolean(parsed.isMiniMode),
            alwaysOnTop: Boolean(parsed.alwaysOnTop),
            closeToTray: parsed.closeToTray !== undefined ? Boolean(parsed.closeToTray) : true,
            soundEffects: parsed.soundEffects !== undefined ? Boolean(parsed.soundEffects) : true,
            lastDevice: parsed.lastDevice && typeof parsed.lastDevice.host === 'string'
              ? { ...parsed.lastDevice }
              : null
          };
          return this.getState();
        }
      }
    } catch (error) {
      // Fallback to default state on corrupt or unreadable file
    }

    this.state = WindowStateManager.createDefaultState();
    return this.getState();
  }

  save() {
    if (!this.filePath) {
      return this.getState();
    }
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      // Ignore write failures in read-only environments
    }
    return this.getState();
  }

  updateNormalBounds(bounds) {
    if (!bounds || typeof bounds !== 'object') {
      return this.getState();
    }
    this.state.normalBounds = WindowStateManager.sanitizeBounds(
      bounds,
      this.state.normalBounds,
      760,
      680
    );
    return this.save();
  }

  updateMiniBounds(bounds) {
    if (!bounds || typeof bounds !== 'object') {
      return this.getState();
    }
    this.state.miniBounds = WindowStateManager.sanitizeBounds(
      bounds,
      this.state.miniBounds,
      320,
      640
    );
    return this.save();
  }

  setMiniMode(isMiniMode, currentBounds = null) {
    const nextMini = Boolean(isMiniMode);
    if (currentBounds && typeof currentBounds === 'object') {
      if (!this.state.isMiniMode && nextMini && currentBounds.width >= 700) {
        this.state.normalBounds = WindowStateManager.sanitizeBounds(
          currentBounds,
          this.state.normalBounds,
          760,
          680
        );
      } else if (this.state.isMiniMode && !nextMini) {
        this.state.miniBounds = WindowStateManager.sanitizeBounds(
          currentBounds,
          this.state.miniBounds,
          320,
          640
        );
      }
    }

    this.state.isMiniMode = nextMini;
    this.save();

    return {
      isMiniMode: nextMini,
      targetBounds: nextMini
        ? { ...this.state.miniBounds }
        : { ...this.state.normalBounds }
    };
  }

  updatePreferences(prefs = {}) {
    if (!prefs || typeof prefs !== 'object') {
      return this.getState();
    }
    if (typeof prefs.closeToTray === 'boolean') {
      this.state.closeToTray = prefs.closeToTray;
    }
    if (typeof prefs.soundEffects === 'boolean') {
      this.state.soundEffects = prefs.soundEffects;
    }
    if (typeof prefs.alwaysOnTop === 'boolean') {
      this.state.alwaysOnTop = prefs.alwaysOnTop;
    }
    if (prefs.lastDevice && typeof prefs.lastDevice.host === 'string') {
      this.state.lastDevice = { ...prefs.lastDevice };
    }
    return this.save();
  }

  updateLastDevice(device) {
    if (!device || typeof device.host !== 'string') {
      return this.getState();
    }
    this.state.lastDevice = { ...device };
    return this.save();
  }

  getState() {
    return {
      normalBounds: { ...this.state.normalBounds },
      miniBounds: { ...this.state.miniBounds },
      isMiniMode: this.state.isMiniMode,
      alwaysOnTop: this.state.alwaysOnTop,
      closeToTray: this.state.closeToTray,
      soundEffects: this.state.soundEffects,
      lastDevice: this.state.lastDevice ? { ...this.state.lastDevice } : null
    };
  }
}

module.exports = WindowStateManager;
