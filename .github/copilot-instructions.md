# RemoteKu - GitHub Copilot Instructions

## Project Overview
RemoteKu is an Electron-based desktop application for controlling Roku devices over the local network. It provides a remote control interface, device discovery via SSDP, and app launching capabilities.

## Technology Stack
- **Runtime**: Node.js 14+
- **Framework**: Electron (desktop app framework)
- **Dependencies**: 
  - axios (HTTP requests to Roku ECP API)
  - fast-xml-parser (parsing XML responses from Roku)
- **Testing**: Node.js built-in test runner (`node --test`)
- **Build**: electron-builder for packaging

## Architecture
- **main.js**: Electron main process - window management and app lifecycle
- **preload.js**: Context bridge for secure IPC - instantiates RokuClient and exposes safe API to renderer
- **renderer.js**: UI logic and event handling (renderer process)
- **roku-client.js**: Roku API client for SSDP discovery and ECP control (used via preload script)
- **index.html**: Main UI structure
- **styles.css**: Application styling

## Security Best Practices
- Always maintain context isolation (`contextIsolation: true`)
- Keep Node integration disabled in renderer (`nodeIntegration: false`)
- Use contextBridge API for secure IPC communication
- Never expose Node.js APIs directly to renderer process
- Follow Electron security best practices

## Code Style and Conventions
- Use modern JavaScript (ES6+) syntax
- Use CommonJS modules (`require`/`module.exports`) for Node.js/Electron compatibility
- Use `async/await` for asynchronous operations
- Use `const` and `let`, avoid `var`
- Follow Node.js error handling patterns
- Use descriptive variable and function names in camelCase
- Keep functions focused and single-purpose

## Testing Guidelines
- Tests are located in the `test/` directory
- Use Node.js built-in test runner: `require('node:test')` and `require('node:assert/strict')`
- Write integration tests that test real functionality with mock servers
- Test edge cases and error conditions
- Use `t.after()` for cleanup in tests
- Run tests with: `npm test`

## Roku ECP API Integration
- Device discovery uses SSDP (Simple Service Discovery Protocol) on UDP multicast
- Roku ECP uses HTTP: `/query/*` endpoints are fetched with GET, while `/keypress/*` and `/launch/*` endpoints use POST
- Common endpoints (include the correct HTTP method when calling them):
  - `/query/device-info` (GET) - Get device information
  - `/query/apps` (GET) - List installed apps
  - `/keypress/{Key}` (POST) - Send remote control keys
  - `/launch/{appId}` (POST) - Launch an app
- Parse XML responses using fast-xml-parser
- Handle network errors gracefully

## Build and Development
- Start dev: `npm start`
- Run tests: `npm test`
- Build packages: `npm run dist`
- Output directory: `builds/`
- Supported platforms: macOS (DMG), Windows (NSIS), Linux (AppImage)

## File Exclusions
When making changes, never modify or include in builds:
- `test/` directory (excluded from builds)
- `.github/` directory
- `builds/` directory (output)
- Markdown files (documentation)

## Common Patterns
- IPC communication: Use `ipcMain` and `ipcRenderer` via contextBridge
- HTTP requests: Use axios with proper timeout and error handling
- XML parsing: Use XMLParser from fast-xml-parser
- Socket creation: Use Node.js dgram module for UDP
- Async operations: Always use try/catch with async/await

## Error Handling
- Always handle network errors (device not found, timeout, connection refused)
- Provide fallback values for missing device information
- Log errors for debugging but handle them gracefully in UI
- Don't crash on failed API calls

## UI/UX Considerations
- Keep UI responsive - all network calls are async
- Provide visual feedback for actions
- Handle device disconnection gracefully
- Support keyboard shortcuts for remote control
- Make UI intuitive and clean

## macOS Specific Notes
- Network discovery requires local network permissions
- Code signing disabled for CI builds (identity: null)
- Uses entitlements file: `entitlements.mac.plist`

## CI/CD
- GitHub Actions workflow builds for all platforms
- Packages are unsigned in CI
- Artifacts uploaded from `builds/` directory
