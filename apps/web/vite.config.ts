import { APP_NAME } from '@apace/model';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Fills %APP_NAME% in index.html from the one constant that holds the name.
function appName(): Plugin {
  return {
    name: 'apace:app-name',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
    },
  };
}

// `vite build --mode bench` compiles src/bench/ in; production builds leave it out.
export default defineConfig({
  plugins: [react(), appName()],
  server: { port: 5173, strictPort: true },
});
