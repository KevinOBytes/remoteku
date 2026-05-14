const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') {
  process.exit(0);
}

const APP_PROCESS_PATTERN = '/builds/mac-arm64/RemoteKu.app/Contents/MacOS/RemoteKu';
const APP_BUNDLE_ID = 'com.kevinobytes.remoteku';
const POLL_INTERVAL_MS = 250;
const TIMEOUT_MS = 5000;

function runningPids() {
  try {
    const output = execFileSync('pgrep', ['-f', APP_PROCESS_PATTERN], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output
      .split('\n')
      .map((line) => Number.parseInt(line, 10))
      .filter(Number.isInteger)
      .filter((pid) => pid !== process.pid);
  } catch (error) {
    return [];
  }
}

function quitApp() {
  try {
    execFileSync('osascript', ['-e', `tell application id "${APP_BUNDLE_ID}" to quit`], {
      stdio: 'ignore'
    });
  } catch (error) {
    // If Launch Services cannot resolve the app, fall back to the PID check below.
  }
}

function forceQuit(pids) {
  pids.forEach((pid) => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      // The process may already have exited.
    }
  });
}

async function waitForExit() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    if (runningPids().length === 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  const initialPids = runningPids();
  if (initialPids.length === 0) {
    return;
  }

  console.log('RemoteKu is running from builds/mac-arm64. Quitting it before packaging...');
  quitApp();

  if (await waitForExit()) {
    return;
  }

  forceQuit(runningPids());
  if (!(await waitForExit())) {
    console.error('Unable to stop the running RemoteKu app before packaging.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
