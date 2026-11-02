// Сборка helper.dylib (arm64 и x86_64). На Windows ничего не делает.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') process.exit(0);
const dir = path.join(__dirname, '..', 'mac');
const src = path.join(dir, 'helper.swift'), out = path.join(dir, 'helper.dylib');
if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) process.exit(0);
const parts = ['arm64', 'x86_64'].map((arch) => {
  const f = `${out}.${arch}`;
  execFileSync('swiftc', ['-O', '-emit-library', '-target', `${arch}-apple-macos13`, '-o', f, src], { stdio: 'inherit' });
  return f;
});
execFileSync('lipo', ['-create', ...parts, '-output', out]);
parts.forEach((f) => fs.rmSync(f));
