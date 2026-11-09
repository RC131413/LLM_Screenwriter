import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  const api = environment.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000/api/';
  const apiOrigin = api.startsWith('/') ? '' : new URL(api).origin;
  const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http:; font-src 'self'; connect-src 'self' ${apiOrigin}; object-src 'none'; base-uri 'self'; form-action 'self'`;
  return {
    plugins: [react(), ...(command === 'build' ? [{
      name: 'production-csp',
      transformIndexHtml() {
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' as const }];
      },
    }] : [])],
    preview: { headers: {
      'Content-Security-Policy': policy + "; frame-ancestors 'none'", 'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    } },
  };
});
