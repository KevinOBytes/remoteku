const path = require('path');
const { execFileSync } = require('child_process');
const { findBundleExecutables, patchExecutableUuid } = require('./macho_uuid');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appId = context.packager.appInfo.id || 'com.kevinobytes.remoteku';
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  const entitlementsPath = path.join(__dirname, '..', 'entitlements.mac.plist');

  const executables = findBundleExecutables(appPath, productFilename);
  for (const executablePath of executables) {
    const relativePath = path.relative(appPath, executablePath);
    const results = patchExecutableUuid(executablePath, `${appId}:${relativePath}`);
    for (const entry of results) {
      console.log(`  • patched LC_UUID (${relativePath}): ${entry.oldUuid} -> ${entry.newUuid}`);
    }
  }

  console.log(`  • ad-hoc signing ${appPath} with bound Info.plist and entitlements`);
  execFileSync(
    'codesign',
    [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--entitlements',
      entitlementsPath,
      appPath
    ],
    { stdio: 'inherit' }
  );
};
