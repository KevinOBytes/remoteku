const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const entitlementsPath = path.join(__dirname, '..', 'entitlements.mac.plist');

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
