import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://it-ticketing-backend-dev:3001',
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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

          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router') || id.includes('@tanstack/react-query')) {
            return 'react-vendor';
          }

          if (id.includes('recharts') || id.includes('chart.js') || id.includes('jspdf') || id.includes('html2canvas') || id.includes('xlsx')) {
            return 'reporting-vendor';
          }

          if (id.includes('@radix-ui') || id.includes('lucide-react') || id.includes('class-variance-authority') || id.includes('tailwind-merge') || id.includes('sonner') || id.includes('cmdk') || id.includes('vaul')) {
            return 'ui-vendor';
          }

          if (id.includes('framer-motion')) {
            return 'motion-vendor';
          }

          if (id.includes('@tiptap') || id.includes('prosemirror')) {
            return 'editor-vendor';
          }

          if (id.includes('react-markdown') || id.includes('rehype') || id.includes('remark') || id.includes('dompurify') || id.includes('turndown')) {
            return 'content-vendor';
          }

          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) {
            return 'form-vendor';
          }

          if (id.includes('@dnd-kit')) {
            return 'dnd-vendor';
          }

          if (id.includes('date-fns') || id.includes('react-day-picker')) {
            return 'date-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
}));
