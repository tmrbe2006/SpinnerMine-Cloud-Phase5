import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

async function buildElectron() {
  const distDir = path.resolve(process.cwd(), 'dist-electron');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log('[build:electron] Bundling Electron Main Process...');

  // 1. Bundle Main Process
  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), 'desktop/main.ts')],
    outfile: path.resolve(distDir, 'main.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    external: [
      'electron',
      'fsevents'
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
    },
    banner: {
      js: '// SpinnerMine Cloud - Bundled Electron Main Process\n'
    }
  });

  console.log('[build:electron] Main process bundled -> dist-electron/main.cjs');

  // 2. Bundle Preload Script
  console.log('[build:electron] Bundling Electron Preload Script...');
  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), 'desktop/preload.ts')],
    outfile: path.resolve(distDir, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    external: [
      'electron'
    ],
    banner: {
      js: '// SpinnerMine Cloud - Bundled Electron Preload Script\n'
    }
  });

  console.log('[build:electron] Preload bundled -> dist-electron/preload.cjs');
  console.log('[build:electron] Electron build completed successfully.');
}

buildElectron().catch((err) => {
  console.error('[build:electron] FATAL BUILD ERROR:', err);
  process.exit(1);
});
