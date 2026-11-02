// Подпись без сертификата: иначе bundle id остаётся от Electron, и система путает разрешения Islet с чужими.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = ({ appOutDir, packager }) => {
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
