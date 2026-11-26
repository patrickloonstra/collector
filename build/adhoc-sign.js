'use strict';
/** Zonder Apple Developer-account: lokaal ("ad hoc") ondertekenen, anders start de app niet op Apple Silicon. */
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async ctx => {
  if (ctx.electronPlatformName !== 'darwin') return;
  const appPath = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
