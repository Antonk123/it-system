import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(() => ({
  // tools/sqlite-mcp och server/ är fristående paket med egna beroenden och
  // egen vitest-svit — appens svit ska inte plocka upp deras tester.
  // Speglar att tools/ redan är exkluderad från eslint (eslint.config.js).
  test: {
    exclude: [...configDefaults.exclude, "tools/**", "server/**", "e2e/**"],
    // Täckningsratchet (baslinje 2026-10-09: 41/40/33/43). Höj när sviten växer,
    // sänk aldrig utan beslut. shadcn-primitiverna i components/ui är vendorkod.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.*", "src/components/ui/**", "src/sw.ts"],
      reporter: ["text-summary"],
      thresholds: { statements: 38, branches: 37, functions: 30, lines: 39 },
    },
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
        description: 'Internt ärendehanteringssystem för IT-support',
        lang: 'sv',
        // Följer standardmärkets grund (src/assets/logo-default.svg). Var tidigare
        // #ff9e4d — en orange som hörde till det gamla märkets bock och blev
        // föräldralös när märket byttes.
        theme_color: '#1C1C1E',
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
        // Lazy-laddade vendor-chunks som bara en enskild vy behöver precachas inte
        // — de hämtas on-demand. editor-vendor (TipTap) är kritisk för
        // svars-/kommentarsflödet och precachas därför så att det fungerar
        // offline/vid flaky nät i PWA:n. motion-vendor och övriga delade
        // vendor-chunks precachas också: en chunk som app-skalet importerar och
        // som saknas i cachen ger blank skärm vid första laddning efter en
        // SW-uppdatering på flaky nät. recharts följer sin sida (AreaChart-chunken)
        // och precachas för att chunk-namnet inte är stabilt nog att filtrera på.
        globIgnores: [
          '**/dnd-vendor*.js',
          // markdown-it-förhandsvisningen är bara en vy — lazy-laddas on demand.
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
    rolldownOptions: {
      output: {
        // Bara beroenden som delas av många vyer får egna vendor-chunks. TipTap,
        // recharts och dnd-kit ska följa sina lazy-laddade sidor: en gemensam
        // vendor-grupp lyfte in dem (via Rolldowns interop-hjälpare) i den
        // eager-laddade startgrafen så att varje route hämtade ~1,6 MB.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: 'query-vendor', test: /node_modules[\\/]@tanstack[\\/](react-query|query-core)[\\/]/ },
            { name: 'radix-vendor', test: /node_modules[\\/](@radix-ui|cmdk)[\\/]/ },
            { name: 'motion-vendor', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
            { name: 'icons-vendor', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'date-vendor', test: /node_modules[\\/]date-fns[\\/]/ },
            { name: 'dnd-vendor', test: /node_modules[\\/]@dnd-kit[\\/]/ },
            { name: 'editor-vendor', test: /node_modules[\\/](@tiptap|prosemirror-[^\\/]+)[\\/]/ },
            // markdown-it och dess beroenden laddas bara av förhandsvisningen.
            { name: 'markdown-vendor', test: /node_modules[\\/](markdown-it|linkify-it|mdurl|punycode)[\\/]/ },
          ],
        },
      },
    },
  },
}));
