(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RemoteKuLogic = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_FAVORITES = [
    { name: 'Netflix', id: '12', matcher: /netflix/i, accent: '#e50914', shade: '#9b0410', text: '#ffffff' },
    { name: 'YouTube', id: '837', matcher: /youtube|you tube/i, accent: '#ff0033', shade: '#b80024', text: '#ffffff' },
    { name: 'Hulu', id: '2285', matcher: /hulu/i, accent: '#1ce783', shade: '#09a65b', text: '#04110a' },
    { name: 'Max', id: '61322', matcher: /\bmax\b|hbo/i, accent: '#2f63ff', shade: '#1429c8', text: '#ffffff' },
    { name: 'Disney+', shortcutLabel: 'Disney+', id: '291097', matcher: /disney/i, accent: '#5b8dff', shade: '#1f4da6', text: '#ffffff' },
    {
      name: 'Prime Video',
      shortcutLabel: 'Prime',
      id: '13',
      matcher: /prime video|amazon/i,
      accent: '#00a8e1',
      shade: '#006b9c',
      text: '#ffffff'
    }
  ];

  const CUSTOM_PIN_PALETTE = [
    { accent: '#06b6d4', shade: '#0e7490', text: '#ffffff' },
    { accent: '#8b5cf6', shade: '#5b21b6', text: '#ffffff' },
    { accent: '#f59e0b', shade: '#b45309', text: '#ffffff' },
    { accent: '#10b981', shade: '#047857', text: '#ffffff' },
    { accent: '#ec4899', shade: '#9d174d', text: '#ffffff' },
    { accent: '#3b82f6', shade: '#1d4ed8', text: '#ffffff' }
  ];

  function normalizeHostInput(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'http://' || trimmed === 'https://') {
      return null;
    }
    const withScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `http://${trimmed}`;
    try {
      const url = new URL(withScheme);
      if (!url.hostname) {
        return null;
      }
      if (!url.port) {
        url.port = '8060';
      }
      return url;
    } catch (error) {
      return null;
    }
  }

  function formatDurationMs(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
      return '—';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const secPadded = String(seconds).padStart(2, '0');
    if (hours > 0) {
      const minPadded = String(minutes).padStart(2, '0');
      return `${hours}:${minPadded}:${secPadded}`;
    }
    return `${minutes}:${secPadded}`;
  }

  function formatPlaybackProgress(positionMs, durationMs) {
    const elapsedText = formatDurationMs(positionMs);
    const durationText = formatDurationMs(durationMs);
    let percent = 0;
    if (
      typeof positionMs === 'number' &&
      typeof durationMs === 'number' &&
      Number.isFinite(positionMs) &&
      Number.isFinite(durationMs) &&
      durationMs > 0
    ) {
      percent = Math.max(0, Math.min(100, Math.round((positionMs / durationMs) * 100)));
    }
    return { elapsedText, durationText, percent };
  }

  function resolveShortcutKey(eventLike = {}) {
    const rawKey = typeof eventLike.key === 'string' ? eventLike.key : '';
    if (!rawKey) {
      return null;
    }

    const meta = Boolean(eventLike.metaKey);
    const ctrl = Boolean(eventLike.ctrlKey);
    const alt = Boolean(eventLike.altKey);
    const shift = Boolean(eventLike.shiftKey);

    if (alt) {
      return null;
    }

    if (meta || ctrl) {
      const lower = rawKey.toLowerCase();
      if (lower === 'k') {
        return { type: 'ui', action: 'focus-keyboard' };
      }
      if (lower === 'f') {
        return { type: 'ui', action: 'focus-apps-search' };
      }
      if (lower === 'r') {
        return { type: 'ui', action: 'rescan' };
      }
      if (lower === 'm' && shift) {
        return { type: 'ui', action: 'toggle-mini-mode' };
      }
      if (rawKey === '/') {
        return { type: 'ui', action: 'toggle-shortcuts-modal' };
      }
      return null;
    }

    if (rawKey === '?') {
      return { type: 'ui', action: 'toggle-shortcuts-modal' };
    }
    if (rawKey === '/') {
      return { type: 'ui', action: 'focus-keyboard' };
    }

    if (rawKey === ' ' || rawKey === 'MediaPlayPause' || rawKey === 'k' || rawKey === 'K') {
      return { type: 'roku', key: 'Play', isPlayToggle: true };
    }

    const directMap = {
      ArrowUp: 'Up',
      w: 'Up',
      W: 'Up',
      ArrowDown: 'Down',
      s: 'Down',
      S: 'Down',
      ArrowLeft: 'Left',
      a: 'Left',
      A: 'Left',
      ArrowRight: 'Right',
      d: 'Right',
      D: 'Right',
      Enter: 'Select',
      Backspace: 'Back',
      Escape: 'Back',
      Home: 'Home',
      h: 'Home',
      H: 'Home',
      m: 'VolumeMute',
      M: 'VolumeMute',
      '+': 'VolumeUp',
      '=': 'VolumeUp',
      '-': 'VolumeDown',
      '_': 'VolumeDown',
      i: 'Info',
      I: 'Info',
      '*': 'Info',
      r: 'InstantReplay',
      R: 'InstantReplay',
      '[': 'Rev',
      j: 'Rev',
      J: 'Rev',
      ']': 'Fwd',
      l: 'Fwd',
      L: 'Fwd'
    };

    const mapped = directMap[rawKey];
    if (mapped) {
      return { type: 'roku', key: mapped };
    }
    return null;
  }

  function findMatchingDefaultFavorite(app, defaultFavorites = DEFAULT_FAVORITES) {
    if (!app) return null;
    const appId = String(app.id ?? '');
    const appName = String(app.name ?? '');
    return defaultFavorites.find((fav) => fav.id === appId || (fav.matcher && fav.matcher.test(appName))) || null;
  }

  function togglePinnedAppId(pinnedIds = [], appId, maxPins = 6) {
    const normalizedId = String(appId ?? '').trim();
    const list = Array.isArray(pinnedIds) ? pinnedIds.map((id) => String(id)) : [];
    if (!normalizedId) {
      return { pinnedIds: list, action: 'noop' };
    }

    const existingIdx = list.indexOf(normalizedId);
    if (existingIdx >= 0) {
      const next = list.filter((id) => id !== normalizedId);
      return { pinnedIds: next, action: 'unpinned' };
    }

    if (list.length >= maxPins) {
      return { pinnedIds: list, action: 'limit-reached' };
    }

    return {
      pinnedIds: [...list, normalizedId],
      action: 'pinned'
    };
  }

  function mergePinnedApps(pinnedIds = [], installedApps = [], defaultFavorites = DEFAULT_FAVORITES) {
    const pins = Array.isArray(pinnedIds) ? pinnedIds.map((id) => String(id)) : [];
    const apps = Array.isArray(installedApps) ? installedApps : [];
    const result = [];
    const usedIds = new Set();

    // 1. Add user-pinned apps first in exact pin order
    pins.forEach((pinId, idx) => {
      if (result.length >= 6) return;
      const installed = apps.find((a) => String(a?.id) === pinId);
      const favPreset = defaultFavorites.find((f) => String(f.id) === pinId) ||
        findMatchingDefaultFavorite(installed, defaultFavorites);
      const palette = favPreset || CUSTOM_PIN_PALETTE[idx % CUSTOM_PIN_PALETTE.length];
      const name = installed?.name || favPreset?.name || `App ${pinId}`;
      const shortcutLabel = favPreset?.shortcutLabel || (name.length > 9 ? name.slice(0, 8) + '…' : name);

      result.push({
        id: pinId,
        name,
        shortcutLabel,
        accent: palette.accent,
        shade: palette.shade,
        text: palette.text || '#ffffff',
        pinned: true
      });
      usedIds.add(pinId);
    });

    // 2. Fill remaining slots up to 6 from defaultFavorites
    defaultFavorites.forEach((fav) => {
      if (result.length >= 6) return;
      const installed = apps.find((a) => String(a?.id) === fav.id || (fav.matcher && fav.matcher.test(a?.name || '')));
      const resolvedId = String(installed?.id || fav.id);
      if (usedIds.has(resolvedId)) return;

      result.push({
        id: resolvedId,
        name: installed?.name || fav.name,
        shortcutLabel: fav.shortcutLabel || fav.name,
        accent: fav.accent,
        shade: fav.shade,
        text: fav.text || '#ffffff',
        pinned: pins.includes(resolvedId)
      });
      usedIds.add(resolvedId);
    });

    return result.slice(0, 6);
  }

  function filterApps(apps = [], { query = '', pinnedIds = [], filterMode = 'all' } = {}) {
    if (!Array.isArray(apps)) {
      return [];
    }
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const pinSet = new Set((Array.isArray(pinnedIds) ? pinnedIds : []).map((id) => String(id)));

    const filtered = apps.filter((app) => {
      if (!app) return false;
      const idStr = String(app.id ?? '');
      const nameStr = String(app.name ?? '');
      if (filterMode === 'pinned' && !pinSet.has(idStr)) {
        return false;
      }
      if (normalizedQuery) {
        return nameStr.toLowerCase().includes(normalizedQuery) || idStr.toLowerCase().includes(normalizedQuery);
      }
      return true;
    });

    return filtered.slice().sort((a, b) => {
      const aId = String(a?.id ?? '');
      const bId = String(b?.id ?? '');
      const aPinned = pinSet.has(aId);
      const bPinned = pinSet.has(bId);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      if (aPinned && bPinned) {
        return pinnedIds.map(String).indexOf(aId) - pinnedIds.map(String).indexOf(bId);
      }
      return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
  }

  function getAppMonogram(name) {
    const cleaned = String(name || '').trim();
    if (!cleaned) {
      return 'RK';
    }
    if (cleaned.includes('+')) {
      return (cleaned[0].toUpperCase() + '+');
    }
    const words = cleaned.split(/[\s\-_:]+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return cleaned.slice(0, 1).toUpperCase();
  }

  return {
    DEFAULT_FAVORITES,
    CUSTOM_PIN_PALETTE,
    normalizeHostInput,
    formatDurationMs,
    formatPlaybackProgress,
    resolveShortcutKey,
    findMatchingDefaultFavorite,
    togglePinnedAppId,
    mergePinnedApps,
    filterApps,
    getAppMonogram
  };
});
