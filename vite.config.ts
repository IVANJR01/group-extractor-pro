import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

let pendingExtractedData: unknown = null;

export default defineConfig({
  plugins: [
    {
      name: 'gep-bridge',
      configureServer(server) {
        // Middleware para o Robô WhatsApp Multi-Chip
        server.middlewares.use('/api/robot', async (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.setHeader('Content-Type', 'application/json');

          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          try {
            const { robotManager } = await import('./server/robotManager.js');
            const url = new URL(req.url || '', 'http://localhost');
            const pathname = url.pathname;

            if (req.method === 'GET' && (pathname === '/status' || pathname === '' || pathname === '/')) {
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true, ...robotManager.getStatus() }));
              return;
            }

            if (req.method === 'POST') {
              let bodyStr = '';
              req.on('data', (c) => { bodyStr += c; });
              req.on('end', async () => {
                try {
                  const body = bodyStr ? JSON.parse(bodyStr) : {};

                  if (pathname === '/connect') {
                    const result = await robotManager.connectChip(body.chipIndex ?? 0, body.phone || null);
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true, ...result }));
                    return;
                  }

                  if (pathname === '/disconnect') {
                    if (body.all) {
                      await robotManager.disconnectAll();
                    } else {
                      await robotManager.disconnectChip(body.chipIndex ?? 0);
                    }
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true }));
                    return;
                  }

                  if (pathname === '/start') {
                    const result = await robotManager.startAddingContacts({
                      groupLinkOrJid: body.groupUrl,
                      contacts: body.contacts || [],
                      delaySeconds: body.delaySeconds || 20,
                      dailyLimitPerChip: body.dailyLimit || 20,
                    });
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true, ...result }));
                    return;
                  }

                  if (pathname === '/pause') {
                    robotManager.pauseTask();
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true }));
                    return;
                  }

                  if (pathname === '/resume') {
                    robotManager.resumeTask();
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true }));
                    return;
                  }

                  if (pathname === '/stop') {
                    robotManager.stopTask();
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true }));
                    return;
                  }

                  if (pathname === '/clear-logs') {
                    robotManager.clearLogs();
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true }));
                    return;
                  }

                  res.statusCode = 404;
                  res.end(JSON.stringify({ error: 'Rota não encontrada' }));
                } catch (err: any) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: err.message || 'Erro interno' }));
                }
              });
              return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Método não permitido' }));
          } catch (serverErr: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: serverErr.message || 'Erro no servidor do robô' }));
          }
        });

        server.middlewares.use('/api/extracted-contacts', (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          if (req.method === 'DELETE') {
            pendingExtractedData = null;
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, message: 'Fila limpa com sucesso' }));
            return;
          }

          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body);
                parsed._receivedAt = Date.now();
                pendingExtractedData = parsed;
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true, message: 'Dados recebidos com sucesso' }));
              } catch {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'JSON inválido' }));
              }
            });
            return;
          }

          if (req.method === 'GET') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            const dataToSend = pendingExtractedData;
            // Se for consumido, zera para não sobrescrever importações manuais posteriores
            const urlObj = new URL(req.url || '', 'http://localhost');
            if (urlObj.searchParams.get('consume') === 'true') {
              pendingExtractedData = null;
            }
            res.end(JSON.stringify(dataToSend || null));
            return;
          }
        });
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) return 'charts';
          if (id.includes('node_modules/@supabase')) return 'supabase';
        },
      },
    },
  },
});
