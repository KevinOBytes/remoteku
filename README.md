# RemoteKu - Roku Remote Control

A powerful Electron-based remote control application for Roku devices, built for macOS and other platforms.

## Features

- **Automatic Device Discovery**: Finds Roku devices on your network using SSDP discovery
- **Multi-Device Support**: Select from multiple Roku devices on your network
- **Full Remote Control**: Complete remote control interface including:
  - Navigation pad (up, down, left, right, OK/select)
  - Control buttons (power, home, back, star)
  - Media playback controls (play, pause, play/pause toggle, fast forward, rewind, instant replay)
  - Volume controls (volume up, volume down, mute)
  - Search functionality
- **App Launcher**: Browse and launch installed Roku apps via an intuitive tile interface
- **Keyboard Shortcuts**: Control your Roku using arrow keys, Enter, Space, and more
- **Modern UI**: Clean, responsive design with a beautiful gradient interface

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/KevinOBytes/remoteku.git
   cd remoteku
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application (from the repo root):
   ```bash
   npm start
   ```

4. (Optional) Run the tests:
   ```bash
   npm test
   ```

> **macOS note:** Discovery uses SSDP multicast. When prompted on first launch, allow the app to access your local network in macOS privacy settings or firewall, and make sure your Mac is on the same Wi‑Fi/Ethernet network as the Roku.

## Usage

### Device Selection
- On startup, the app automatically discovers Roku devices on your network
- Select your device from the dropdown menu at the top
- Click "Refresh" to search for devices again

### Remote Control
- Use the on-screen buttons to control your Roku device
- The central OK button selects items
- Navigation arrows move through menus
- Media controls at the bottom control playback
- Volume controls adjust audio

### Keyboard Shortcuts
- **Arrow Keys**: Navigate up/down/left/right
- **Enter**: Select/OK
- **Space**: Play/Pause
- **Backspace**: Back
- **Escape/Home**: Home screen

### App Launcher
- View all installed apps in the right panel
- Click any app tile to launch that app on your Roku
- Click "Refresh Apps" to reload the app list

## Requirements

- Node.js 14 or higher
- A Roku device on the same network
- macOS, Windows, or Linux

## Technical Details

### Roku ECP API
This application uses the Roku External Control Protocol (ECP) API to communicate with Roku devices:
- Device discovery via SSDP (Simple Service Discovery Protocol)
- Device control via HTTP POST requests
- App queries via HTTP GET requests

### Architecture
- **main.js**: Electron main process with secure window configuration
- **preload.js**: Context bridge for secure IPC between main and renderer processes
- **renderer.js**: UI logic and event handling (runs in renderer process)
- **roku-client.js**: Roku API client for discovery and control (runs in main process)
- **index.html**: Main UI structure
- **styles.css**: Application styling

### Security
This application implements Electron security best practices:
- Context isolation enabled
- Node integration disabled in renderer
- Secure IPC via contextBridge
- No direct access to Node.js APIs from renderer

## Development

To contribute or modify:

1. Make your changes to the source files
2. Test with `npm start`
3. Submit a pull request

## CI builds

- The GitHub Actions workflow packages the app for Windows, macOS, and Linux and uploads the artifacts from the `builds` output directory.
- macOS packages built in CI are unsigned (code signing is disabled), so macOS may show Gatekeeper warnings when opening them.

## License

ISC

## Author

KevinOBytes
