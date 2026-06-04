import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.png', 'robots.txt', 'icons/*.png'],
      manifest: {
        name: 'IT-Ticket System',
        short_name: 'IT-Ticket',
        description: 'IT arendehantering & asset management',
        theme_color: '#ff9e4d',
        background_color: '#0f0f14',
        display: 'standalone',
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

          if (id.includes('recharts') || id.includes('chart.js') || id.includes('jspdf') || id.includes('html2canvas') || id.includes('xlsx')) {
            return 'reporting-vendor';
          }

          if (id.includes('@tiptap') || id.includes('prosemirror')) {
            return 'editor-vendor';
          }

          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
            return 'motion-vendor';
          }

          if (id.includes('@radix-ui')) {
            return 'radix-vendor';
          }

          if (id.includes('@dnd-kit')) {
            return 'dnd-vendor';
          }

          if (
            id.includes('react-markdown') ||
            id.includes('rehype') ||
            id.includes('remark') ||
            id.includes('dompurify') ||
            id.includes('turndown') ||
            id.includes('mdast') ||
            id.includes('hast') ||
            id.includes('micromark') ||
            id.includes('unified') ||
            id.includes('unist')
          ) {
            return 'markdown-vendor';
          }

          if (id.includes('lucide-react')) {
            return 'icons-vendor';
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
