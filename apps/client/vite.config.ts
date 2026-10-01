import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { PAGES_LEGALES } from './src/legal/pagesLegales.ts'

/*
 * Les pages légales sont écrites en HTML statique dans dist/ (conditions.html,
 * confidentialite.html, mentions-legales.html) : elles restent lisibles sans
 * JavaScript. En développement, le même HTML est servi avant le repli SPA.
 */
function pagesLegalesStatiques(): Plugin {
  return {
    name: 'pages-legales-statiques',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const chemin = req.url?.split('?')[0]
        const page = PAGES_LEGALES.find((p) => `/${p.chemin}` === chemin)
        if (!page) return next()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(page.html())
      })
    },
    generateBundle() {
      for (const page of PAGES_LEGALES) {
        this.emitFile({ type: 'asset', fileName: `${page.chemin}.html`, source: page.html() })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), pagesLegalesStatiques()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
