# RemoteKu Tech Stack & Developer Guide

RemoteKu is a native, lightweight, and privacy-first desktop remote control and live ECP command deck for Roku TVs and streaming players.

---

## 1. Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                    │
│   (main.js, window-state.js, scripts/after_pack.js)        │
│   • BrowserWindow management (Standard & Mini Remote modes) │
│   • Persistent state & preferences (window-state.json)      │
│   • macOS Tray Menu, Global Shortcuts (⌘⇧R), Touch Bar      │
│   • Mach-O LC_UUID binary patching for macOS Local Network   │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC (contextBridge)
┌──────────────────────────────▼──────────────────────────────┐
│                    Preload Context Bridge                    │
│                        (preload.js)                          │
│   • Exposes secure, context-isolated `window.rokuAPI`        │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                   Renderer / Frontend Deck                  │
│       (index.html, renderer.js, renderer-logic.js, css)     │
│   • Pure domain logic (renderer-logic.js - unit tested)     │
│   • Hardware remote emulation & live keyboard streaming     │
│   • Web Audio API synthesized mechanical click feedback      │
│   • macOS dark translucent material styling (SF Pro)        │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / UDP
┌──────────────────────────────▼──────────────────────────────┐
│                      Roku ECP Client                        │
│                     (roku-client.js)                         │
│   • SSDP multicast auto-discovery (UDP 239.255.255.250:1900)│
│   • Multi-interface binding & Windows loopback handling     │
│   • ARP cache prioritized fallback scanning                 │
│   • Keypress, Keydown, Keyup, and Lit_<char> streaming      │
│   • Universal search (/search/browse) & media telemetry     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Technologies & Tools

- **Runtime & Desktop Framework**: Electron 45 (`electron`, `electron-builder`)
- **HTTP Client**: `axios` (configured with proxy bypass for LAN reliability)
- **XML Parsing**: `fast-xml-parser` (for Roku device-info, apps, and media telemetry XML)
- **Typography & Assets**: Locally bundled `@fontsource/space-grotesk`, `@fontsource/plus-jakarta-sans`, `@fontsource/jetbrains-mono`
- **Audio Engine**: Native HTML5 Web Audio API (`AudioContext`) for zero-latency synthesized mechanical switch clicks
- **Testing**: Native Node.js test runner (`node --test`) with zero external test framework bloat

---

## 3. Key Commands

```bash
# Run unit test suite
npm test

# Launch in local development mode
npm start

# Compile production macOS package (.dmg)
npm run build:mac

# Compile cross-platform distributions via electron-builder
npm run dist -- --mac
npm run dist -- --win
npm run dist -- --linux
```

---

## 4. Engineering Standards & Rules

- **Always verify test suite (`npm test`)** before claiming completion.
- **Ensure builds compile without errors** (`npm run build:mac` or `dist`).
- **Never rely on external cloud servers**: All Roku communication is 100% direct LAN over Roku's External Control Protocol (ECP).
- **macOS Local Network Permissions**: When packaging macOS builds, `scripts/after_pack.js` patches unique Mach-O `LC_UUID` headers to ensure macOS Sequoia and Sonoma maintain local network permissions across app updates.
