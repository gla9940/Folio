import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createHandler } from './server/handler.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [react(), { name: 'folio-private-api', configureServer(server) {
      const handler = createHandler({ env });
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/api/folio') void handler(req, res);
        else next();
      });
    } }],
    test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'] },
  };
});
