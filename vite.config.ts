import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(() => ({
  // tools/codemap är ett fristående verktyg med egna beroenden (ts-morph) och
  // egen testkörning — appens svit ska inte plocka upp dess tester. Speglar att
  // mappen redan är exkluderad från eslint (eslint.config.js).
  test: {
    exclude: [...configDefaults.exclude, "tools/**"],
  },
  server: {
    host: "::",
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://it-ticketing-backend:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the SW ourselves (src/registerSW.ts) to add periodic update
      // checks + auto-reload. Disable the plugin's own bare registration so the
      // SW isn't registered twice.
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.png', 'robots.txt', 'icons/*.png'],
      manifest: {
        name: 'IT-Ticket System',
        short_name: 'IT-Ticket',
        description: 'IT ärendehantering & asset management',
        lang: 'sv',
        theme_color: '#ff9e4d',
        background_color: '#0f0f14',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,woff2}'],
        // Lazy-laddade vendor-chunks precachas inte — de hämtas on-demand.
        // editor-vendor (TipTap) är dock kritisk för svars-/kommentarsflödet
        // och precachas därför så att det fungerar offline/vid flaky nät i PWA:n.
        // motion-vendor (framer-motion) precachas OCKSÅ: det importeras STATISKT av
        // app-skalet (Index/Layout), så att exkludera det gav blank skärm vid första
        // laddning efter SW-uppdatering på flaky nät.
        globIgnores: [
          '**/reporting-vendor*.js',
          '**/dnd-vendor*.js',
          // markdown-vendor (react-markdown, rehype, remark, unified, …) is only
          // used in the ticket-detail rich-text preview — lazy-loaded on demand.
          '**/markdown-vendor*.js',
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('recharts')) {
            return 'reporting-vendor';
          }

          if (id.includes('@tiptap') || id.includes('prosemirror')) {
            return 'editor-vendor';
          }

          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
            return 'motion-vendor';
          }

          if (id.includes('@radix-ui') || id.includes('node_modules/cmdk/')) {
            return 'radix-vendor';
          }

          if (id.includes('@dnd-kit')) {
            return 'dnd-vendor';
          }

          // dompurify exkluderas med avsikt — den importeras statiskt av HtmlRenderer
          // och behöver finnas i det generella vendor-chunken (precachas av SW).
          if (
            id.includes('react-markdown') ||
            id.includes('rehype') ||
            id.includes('remark') ||
            id.includes('turndown') ||
            id.includes('mdast') ||
            id.includes('hast') ||
            id.includes('micromark') ||
            id.includes('unified') ||
            id.includes('unist') ||
            // markdown-it och dess beroenden samlas i markdown-vendor-chunken
            id.includes('node_modules/markdown-it/') ||
            id.includes('node_modules/linkify-it/') ||
            id.includes('node_modules/mdurl/') ||
            id.includes('node_modules/punycode/')
          ) {
            return 'markdown-vendor';
          }

          if (id.includes('lucide-react')) {
            return 'icons-vendor';
          }

          if (id.includes('@tanstack/react-query') || id.includes('@tanstack/query-core')) {
            return 'query-vendor';
          }

          if (id.includes('node_modules/date-fns/')) {
            return 'date-vendor';
          }

          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('react-router') ||
            id.includes('scheduler')
          ) {
            return 'react-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
}));
