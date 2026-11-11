# RemoteKu v2.0 — Comprehensive Upgrade Design Specification

## 1. Intent & Why

RemoteKu is an Electron-based Roku remote control application for macOS, Windows, and Linux. While v1.1.0 provides basic SSDP discovery, a virtual remote, and a basic text-only app list, several high-impact capabilities of the Roku External Control Protocol (ECP), macOS native integration, typography, and desktop ergonomics are either missing or under-utilized:

1. **Missing Roku ECP Capabilities**:
   - No live keyboard/text entry (`/keypress/Lit_<char>`) for searching or entering credentials on the TV.
   - App tiles display only text (`Netflix v1.0`) without fetching official channel icons (`/query/icon/<appId>`).
   - Playback state (`isPlaying`) is guessed locally rather than querying `/query/active-app` and `/query/media-player` for live Now Playing channel and timecode telemetry.
   - No press-and-hold repeat or `/keydown/<key>` + `/keyup/<key>` support for directional navigation and volume rockers.
   - Missing Roku TV / Ultra hardware controls (`FindRemote`, `PowerOn`/`PowerOff`, HDMI 1–4 inputs, Live TV Tuner).
2. **Network & Discovery Edge Cases**:
   - `axios` uses system `HTTP_PROXY` environment variables by default, which breaks local LAN requests (`192.168.x.x`) when a proxy is active.
   - `scanLocalSubnetsForRoku` scans all virtual/tunnel interfaces (`utun*`, `bridge*`, `docker*`, `veth*`), causing 10× slower fallback scans on developer Macs.
   - Startup waits for the full 3+ second SSDP scan before attempting to reconnect to the last saved Roku device.
3. **Interface, Layout & Typography**:
   - Fonts (`Space Grotesk`, `IBM Plex Sans`) are loaded over the internet from `fonts.googleapis.com`, failing offline and lacking a dedicated monospace font for IPs, timecodes, and keycaps.
   - On desktop windows (`1040×820`), the 286px remote sits alone in a mostly empty tab pane instead of displaying a unified side-by-side Command Deck alongside Apps and Live Keyboard tools.
   - Switching devices requires leaving the Remote tab; Mini Mode hides connection status completely.
   - Streaming app shortcuts on the remote body are hardcoded to 6 fixed services and cannot be customized/pinned by the user.
4. **First-Class macOS & Desktop Integration**:
   - No macOS Menu Bar `Tray` icon or quick control menu.
   - Exiting Mini Mode resets the window to a hardcoded `1040×820` instead of restoring the user's saved window bounds.
   - Missing native macOS Application Menu (`Edit` for copy/paste, `Remote` shortcuts, `Window` controls), `TouchBar` controls, `powerMonitor` wake-from-sleep auto-reconnect, and `NSBonjourServices` plist entries for macOS Local Network permissions.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Upgrade all runtime and build dependencies (`axios`, `fast-xml-parser`, `electron`, `electron-builder`) to current latest stable versions and bundle offline fonts (`@fontsource/space-grotesk`, `@fontsource/plus-jakarta-sans`, `@fontsource/jetbrains-mono`).
- Expand `RokuClient` with `sendText`/`encodeLiteralKey`, `keyDown`/`keyUp`, `getAppIcon` (cached base64 data URLs), `getActiveApp`, `getMediaPlayer`, `getNowPlaying`, virtual interface filtering, and proxy-immune HTTP requests.
- Deliver a responsive **Side-by-Side Command Deck** on wide viewports (`>= 860px`) and a streamlined **Mini Mode** with an always-accessible header Device Switcher.
- Allow users to search/filter installed apps, view real Roku channel icons, and pin up to 6 favorite apps directly onto the physical remote's shortcut buttons.
- Integrate deeply with macOS: Menu Bar `Tray` icon with quick controls & device switcher, native Application Menu + `TouchBar`, `CommandOrControl+Shift+R` global summon shortcut, window bounds persistence, `powerMonitor` resume handling, and Local Network plist metadata.

### Non-Goals
- Private Roku cloud account authentication or Roku mobile private listening (which uses proprietary encrypted RTP outside ECP).
- Modifying Roku firmware settings not exposed over HTTP ECP port 8060.

### Anti-Goals
- Never block the UI thread or delay initial reconnection to a known device while waiting for SSDP multicast timeouts.
- Never require external internet connectivity to render fonts or UI icons.

---

## 3. Architecture & Approaches Considered

1. **App Icon Loading Approach**:
   - *Option A*: Point `<img src="http://192.168.1.x:8060/query/icon/12">` directly from renderer HTML. (Trades off: mixed content/CSP issues, no caching across re-renders, broken image flicker on slow TVs).
   - *Option B (Selected)*: Fetch icons in `RokuClient.getAppIcon(appId)` in the main process with `responseType: 'arraybuffer'`, cache as `data:<mime>;base64,...` per `${host}:${appId}`, and return via IPC. Clean, fast, CSP-safe, and easily testable.
2. **Desktop Layout Approach**:
   - *Option A*: Keep Remote, Apps, and Connection strictly in isolated tabs at all window sizes. (Wastes >65% of horizontal space on desktop).
   - *Option B (Selected)*: Responsive **Command Deck** layout. When the `Remote` view is active on wide viewports (`>= 860px`), show the physical Remote on the left and a rich **Companion Dock** (Live TV Keyboard, Pinned/Searchable Apps Launcher, TV Inputs & Hardware Controls) on the right. Keep `Apps` (full-screen app gallery) and `Connection` (diagnostics & network setup) accessible via the top nav pill, and collapse cleanly to single-column in Mini Mode or narrow windows.
3. **Typography Stack**:
   - Bundle `@fontsource/space-grotesk` (headings, brand mark, physical remote legends), `@fontsource/plus-jakarta-sans` (crisp UI controls, app names, dialogs), and `@fontsource/jetbrains-mono` (IP addresses, live playback timecodes, diagnostics, and keyboard shortcut badges).

---

## 4. Detailed Component Specifications

### 4.1 `roku-client.js`
- `constructor()`: Creates `this.httpClient = axios.create({ proxy: false })` and `this.iconCache = new Map()`.
- `static isVirtualInterfaceName(name)`: Returns `true` for virtual/tunnel interface prefixes (`utun`, `bridge`, `awdl`, `llw`, `vmenet`, `vmnet`, `vboxnet`, `docker`, `veth`, `lo`, `gif`, `stf`, `ap`).
- `probeDeviceInfo(host, { timeout })`: Parses additional XML fields from `/query/device-info`:
  - `isTv`: `parseBoolean(deviceInfo['is-tv'])`
  - `powerMode`: `deviceInfo['power-mode'] || null`
  - `supportsFindRemote`: `parseBoolean(deviceInfo['supports-find-remote'])`
  - `softwareVersion`: `deviceInfo['software-version'] ? String(deviceInfo['software-version']) : null`
  - `networkType`: `deviceInfo['network-type'] || null`
  - `udn`: `deviceInfo.udn || null`
- `static encodeLiteralKey(char)`: Encodes a single character into `Lit_<percent-encoded>` where every non-alphanumeric character (including `-`, `_`, `.`, `!`, `~`, `*`, `'`, `(`, `)`, `/`, `?`, `&`, `=`, `+`, `%`, ` `) is percent-encoded as `%XX` UTF-8 bytes so Roku ECP never misinterprets URI delimiters.
- `sendText(text, { charDelayMs = 35 } = {})`: Iterates over `Array.from(String(text))`, sending `sendKey(RokuClient.encodeLiteralKey(ch))` sequentially, returning `true` if all characters succeeded.
- `keyDown(key)` / `keyUp(key)`: Posts to `/keydown/${key}` and `/keyup/${key}` using `postWithRetry`.
- `getAppIcon(appId)`: Fetches `${this.currentDevice.host}/query/icon/${encodeURIComponent(appId)}` as `arraybuffer`, converts to `data:${contentType};base64,${base64}`, caches in `this.iconCache` under `${this.currentDevice.host}:${appId}`, and returns the data URL (or `null` on error).
- `getActiveApp()`: Queries `/query/active-app` and returns `{ app: { id, name, version, type } | null, screensaver: { id, name } | null }`.
- `getMediaPlayer()`: Queries `/query/media-player` and returns `{ state, isPaused, positionMs, durationMs, pluginName }`. Parsers handle `24500 ms` or numeric strings cleanly.
- `getNowPlaying()`: Calls `getActiveApp()` and `getMediaPlayer()` in parallel via `Promise.all` and returns a combined `{ activeApp, screensaver, media }` snapshot.

### 4.2 `window-state.js`, `main.js`, and `preload.js`
- `WindowStateManager` (`window-state.js`): Reads/writes JSON state at `path.join(userDataPath, 'window-state.json')` with `{ bounds: { width, height, x, y }, isMiniMode: false, alwaysOnTop: false, closeToTray: true, soundEffects: true }`. Preserves normal bounds when entering Mini Mode and restores them when exiting Mini Mode.
- `main.js`:
  - Uses `WindowStateManager` to restore window size/position.
  - Creates programmatic macOS template `Tray` icon (16×16 / 32×32 @2x remote silhouette) with a dynamic context menu listing discovered devices, active device checkmark, transport controls (`Play/Pause`, `Mute`, `Vol +`, `Vol -`, `Home`, `Back`, `Power`), `Mini Remote Mode`, and `Quit`.
  - Sets up macOS Application Menu (`RemoteKu`, `Edit`, `Remote`, `Window`, `Help`) and `TouchBar` buttons.
  - Registers global shortcut `CommandOrControl+Shift+R` to toggle/focus the RemoteKu window.
  - Listens to `powerMonitor` `resume` / `unlock-screen` and sends `system:resume` to renderer.
  - Exposes IPC handlers for all new `RokuClient` and window methods, plus `system:open-network-settings` (opens `x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork` on macOS).

### 4.3 `renderer-logic.js`, `index.html`, `styles.css`, `renderer.js`
- `renderer-logic.js`: UMD/CommonJS module shared between `renderer.js` (browser) and `test/renderer-logic.test.js` (Node test runner) containing pure, deterministic functions for:
  - `normalizeHostInput(value)`
  - `formatDurationMs(ms)` and `formatPlaybackProgress(positionMs, durationMs)`
  - `resolveShortcutKey(eventLike)` (all keyboard shortcuts including `m`, `+`, `-`, `i`, `*`, `r`, `[`, `]`, `j`, `k`, `l`, `h`, arrows, `Enter`, `Backspace`, `Escape`)
  - `mergePinnedApps(pinnedIds, installedApps, defaultFavorites)`
  - `filterApps(apps, query, pinnedIds, filterMode)`
  - `getAppMonogram(name)`
- UI Features in `index.html` / `renderer.js` / `styles.css`:
  - Header Quick Device Switcher `<select id="header-device-select">` + Rescan button + Tactile Audio Click toggle + Shortcuts `?` button + Mini Mode toggle.
  - Live **Now Playing** pill/bar showing active Roku channel, playback status badge (`Playing`, `Paused`, `Home`), and progress bar + timecode (`12:34 / 45:00`).
  - **Command Deck** right-hand dock on wide screens with:
    - **Live TV Keyboard** (`#roku-text-input`, Send button, Live-Type toggle where keystrokes stream directly to Roku as you type, plus Backspace/Clear/Enter).
    - **Apps Launcher** with search input (`#apps-search-input`), `All` / `Pinned` filter pills, real channel icons (`<img>` loaded via `getAppIcon`), and pin star buttons (`★`) that customize the 6 shortcut buttons on the remote body.
    - **TV & Hardware Deck**: `Find Remote` (chime), `Power Off`, `HDMI 1`–`4`, `Live TV` tuner buttons.
  - **Hold-to-Repeat**: Holding D-pad, Volume, or Rewind/Fast-Forward buttons repeats commands smoothly.
  - **Keyboard Shortcuts Modal (`#shortcuts-modal`)**: Accessible via `?` key or header button.
