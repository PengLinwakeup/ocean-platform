import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'geomar-v2-export-server',
      configureServer(server) {
        server.middlewares.use('/api/export-geomar-v2', async (req, res) => {
          if (req.method === 'POST') {
            try {
              const scriptPath = path.resolve(__dirname, 'run_geomar_qc_processor_20260820.py');
              const outPath = path.resolve(__dirname, 'temp_geomar_v2_export.xlsx');
              
              exec(`python "${scriptPath}" --output "${outPath}"`, (error) => {
                if (error) {
                  console.error('Python export error:', error);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: error.message }));
                  return;
                }
                
                if (fs.existsSync(outPath)) {
                  const data = fs.readFileSync(outPath);
                  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                  res.setHeader('Content-Disposition', 'attachment; filename="Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2.xlsx"');
                  res.statusCode = 200;
                  res.end(data);
                } else {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: 'Output file not generated' }));
                }
              });
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          } else {
            res.statusCode = 405;
            res.end('Method Not Allowed');
          }
        });
      }
    }
  ],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api-bathy': {
        target: 'https://api.opentopodata.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-bathy/, '')
      }
    }
  }
});
