/**
 * SpinnerMine Cloud - Automated Electron Distribution Asset & Link Integrity Validator
 *
 * Enforces:
 * 1. Existence of dist/index.html, dist-electron/main.cjs, and dist-electron/preload.cjs.
 * 2. Absolute path prohibition: all local asset links in dist/index.html must be relative (./assets/..., ./icon.svg) for file:// protocol.
 * 3. Exact file existence on disk for every local asset referenced in dist/index.html.
 * 4. PWA isolation: registerSW.js and webmanifest must NOT be present in Electron distribution.
 * 5. Presence of root element #root for React mount.
 */

import fs from 'fs';
import path from 'path';

export function validateDistAssets(): boolean {
  console.log('='.repeat(80));
  console.log('SPINNERMINE CLOUD — PRE-PACKAGE ELECTRON ASSET INTEGRITY VALIDATOR');
  console.log('='.repeat(80));

  const rootDir = process.cwd();
  const distDir = path.resolve(rootDir, 'dist');
  const distElectronDir = path.resolve(rootDir, 'dist-electron');
  const indexPath = path.join(distDir, 'index.html');

  // 1. Verify existence of dist/index.html
  if (!fs.existsSync(indexPath)) {
    console.error('FATAL: dist/index.html does not exist! Run "bun run build:electron-web" first.');
    process.exit(1);
  }

  const htmlContent = fs.readFileSync(indexPath, 'utf8');

  // 2. Verify #root element is present
  if (!htmlContent.includes('id="root"')) {
    console.error('FATAL: dist/index.html is missing <div id="root"> element!');
    process.exit(1);
  }
  console.log(' ✓ Found <div id="root"> in dist/index.html');

  // 3. Verify PWA Service Worker is NOT injected into Electron build
  if (htmlContent.includes('registerSW.js') || htmlContent.includes('registerDevSW') || htmlContent.includes('manifest.webmanifest')) {
    console.error('FATAL: PWA Service Worker or manifest detected in Electron dist/index.html!');
    console.error('Electron builds must NOT include registerSW.js or manifest to prevent ERR_FILE_NOT_FOUND on file://');
    process.exit(1);
  }
  console.log(' ✓ Confirmed PWA service worker is completely excluded (no registerSW.js or manifest requests)');

  // 4. Verify no absolute root paths (/assets/, /icon.svg)
  const forbiddenAbsoluteRegex = /(?:src|href)=["']\/(assets\/[^"']+|[^"']+\.(?:js|css|svg|png|jpg|ico))["']/g;
  const absoluteMatches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = forbiddenAbsoluteRegex.exec(htmlContent)) !== null) {
    absoluteMatches.push(match[0]);
  }

  if (absoluteMatches.length > 0) {
    console.error('FATAL: Found forbidden absolute root paths in dist/index.html:');
    for (const m of absoluteMatches) {
      console.error(`  - ${m}`);
    }
    console.error('All asset paths must be relative (e.g. ./assets/...) for Electron file:// protocol compatibility.');
    process.exit(1);
  }
  console.log(' ✓ Confirmed 100% relative path discipline (no leading root slashes in asset paths)');

  // 5. Extract all referenced relative local assets and verify their existence on disk
  const relativeAssetRegex = /(?:src|href)=["'](\.\/[^"']+)["']/g;
  const referencedFiles = new Set<string>();
  while ((match = relativeAssetRegex.exec(htmlContent)) !== null) {
    referencedFiles.add(match[1]);
  }

  console.log(`\nVerifying ${referencedFiles.size} referenced relative assets exist on disk:`);
  let hasJsChunk = false;
  let hasCssChunk = false;

  for (const relPath of referencedFiles) {
    // Strip leading ./
    const cleanRel = relPath.replace(/^\.\//, '');
    const fullDiskPath = path.resolve(distDir, cleanRel);

    if (!fs.existsSync(fullDiskPath)) {
      console.error(` FATAL: Referenced file does NOT exist on disk: ${relPath} (expected at ${fullDiskPath})`);
      process.exit(1);
    }

    const stats = fs.statSync(fullDiskPath);
    if (stats.size === 0) {
      console.error(` FATAL: Referenced file is empty (0 bytes): ${relPath}`);
      process.exit(1);
    }

    if (cleanRel.endsWith('.js')) hasJsChunk = true;
    if (cleanRel.endsWith('.css')) hasCssChunk = true;

    console.log(` ✓ ${relPath.padEnd(35)} (${(stats.size / 1024).toFixed(1)} KB)`);
  }

  if (!hasJsChunk) {
    console.error('FATAL: dist/index.html does not reference any compiled JavaScript chunk!');
    process.exit(1);
  }
  if (!hasCssChunk) {
    console.error('FATAL: dist/index.html does not reference any compiled CSS stylesheet!');
    process.exit(1);
  }

  // 6. Verify dist-electron artifacts
  const mainCjsPath = path.resolve(distElectronDir, 'main.cjs');
  const preloadCjsPath = path.resolve(distElectronDir, 'preload.cjs');

  if (!fs.existsSync(mainCjsPath)) {
    console.error(`FATAL: Main process bundle does not exist at ${mainCjsPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(preloadCjsPath)) {
    console.error(`FATAL: Preload process bundle does not exist at ${preloadCjsPath}`);
    process.exit(1);
  }

  console.log(`\nVerifying Electron runtime bundles:`);
  console.log(` ✓ dist-electron/main.cjs     (${(fs.statSync(mainCjsPath).size / 1024).toFixed(1)} KB)`);
  console.log(` ✓ dist-electron/preload.cjs  (${(fs.statSync(preloadCjsPath).size / 1024).toFixed(1)} KB)`);

  // 7. Verify compiled JavaScript chunks do not contain hardcoded root-absolute static asset URLs
  const jsFiles = fs.readdirSync(path.join(distDir, 'assets')).filter(f => f.endsWith('.js'));
  for (const jsFile of jsFiles) {
    const jsContent = fs.readFileSync(path.join(distDir, 'assets', jsFile), 'utf8');
    if (jsContent.includes('"/icon.svg"') || jsContent.includes("'/icon.svg'") || jsContent.includes('"/favicon.ico"')) {
      console.error(`FATAL: Absolute "/icon.svg" or "/favicon.ico" reference found in compiled bundle: ${jsFile}`);
      console.error('All asset references must be relative (e.g. ./icon.svg) to prevent ERR_FILE_NOT_FOUND in Electron.');
      process.exit(1);
    }
  }

  // 8. Strict Production Firebase Configuration Gate (Requirement 5 & 6)
  console.log(`\nVerifying Production Firebase Configuration Gate:`);
  const configPath = path.resolve(rootDir, 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('FATAL: firebase-applet-config.json does not exist!');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.projectId !== 'spinnermine-cloud-production') {
    console.error(`FATAL: Forbidden non-production Firebase projectId "${config.projectId}" detected!`);
    console.error('Windows Production builds must strictly target "spinnermine-cloud-production".');
    process.exit(1);
  }
  if (config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)') {
    console.error(`FATAL: Forbidden non-default Firestore database "${config.firestoreDatabaseId}" detected! Production must target "(default)".`);
    process.exit(1);
  }
  console.log(` ✓ Verified source config: Project ID = "${config.projectId}", Database = "${config.firestoreDatabaseId || '(default)'}"`);

  // 9. Inspect Final Compiled JavaScript Bundle for Production Firebase targeting
  let foundProductionProjectInBundle = false;
  for (const jsFile of jsFiles) {
    const jsContent = fs.readFileSync(path.join(distDir, 'assets', jsFile), 'utf8');
    if (jsContent.includes('spinnermine-cloud-production')) {
      foundProductionProjectInBundle = true;
    }
    if (jsContent.includes('gen-lang-client-0535145441') || jsContent.includes('ai-studio-spinnerminecloud') || jsContent.includes('grounded-cycling-dv9wh')) {
      console.error(`FATAL: Legacy or development project identifier leaked into compiled Electron asset: ${jsFile}`);
      console.error('Final production bundle must contain strictly "spinnermine-cloud-production"!');
      process.exit(1);
    }
  }

  if (!foundProductionProjectInBundle) {
    console.error('FATAL: Compiled bundle does not contain "spinnermine-cloud-production" target project!');
    process.exit(1);
  }
  console.log(' ✓ Verified compiled Windows bundle strictly targets "spinnermine-cloud-production" with zero dev project leaks.');

  console.log('\n================================================================');
  console.log('SUCCESS: All pre-package asset and link verifications passed!');
  console.log('================================================================\n');
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('validate-dist-assets.ts')) {
  try {
    validateDistAssets();
  } catch (err: any) {
    console.error('Validation crashed:', err);
    process.exit(1);
  }
}
