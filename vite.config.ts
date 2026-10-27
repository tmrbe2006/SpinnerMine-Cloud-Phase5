import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron' || process.env.ELECTRON_BUILD === 'true';

  const plugins = [
    react(),
    tailwindcss(),
  ];

  // Only enable PWA service worker and manifest for standard web builds;
  // completely exclude VitePWA when building for Electron to prevent registerSW.js requests on file://
  if (!isElectron) {
    plugins.push(
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
        manifest: {
          id: '/',
          name: 'SpinnerMine Cloud',
          short_name: 'SpinnerMine',
          description: 'Cryptocurrency mining and interactive gaming platform with transparent revenue distribution.',
          theme_color: '#0a0f1d',
          background_color: '#050a14',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        },
        devOptions: {
          enabled: false,
        },
      })
    );
  }

  const isVitest = Boolean(process.env.VITEST);
  const aliasMap: Record<string, string> = {
    '@': path.resolve('.'),
  };

  if (!isVitest) {
    const stubsPath = path.resolve('src/utils/browser-node-stubs.ts');
    aliasMap['child_process'] = stubsPath;
    aliasMap['fs'] = stubsPath;
    aliasMap['os'] = stubsPath;
    aliasMap['net'] = stubsPath;
    aliasMap['tls'] = stubsPath;
    aliasMap['dns'] = stubsPath;
    aliasMap['crypto'] = stubsPath;
  }

  return {
    base: isElectron ? './' : '/',
    plugins,
    resolve: {
      alias: aliasMap,
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio container environment
      hmr: false,
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
    },
  };
});
