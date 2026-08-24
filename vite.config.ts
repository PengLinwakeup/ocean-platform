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
              const jsonPath = path.resolve(__dirname, 'temp_geomar_v2_input.json');
              const outPath = path.resolve(__dirname, 'temp_geomar_v2_export.xlsx');
              
              let body = '';
              req.on('data', chunk => {
                body += chunk;
              });
              
              // Remove old temp output files so we never serve a stale cached export
              if (fs.existsSync(outPath)) {
                try { fs.unlinkSync(outPath); } catch (e) {}
              }
              const altOutPath = outPath.replace('.xlsx', '_latest.xlsx');
              if (fs.existsSync(altOutPath)) {
                try { fs.unlinkSync(altOutPath); } catch (e) {}
              }

              req.on('end', () => {
                let cmd = `python "${scriptPath}" --output "${outPath}"`;
                if (body && body.trim().length > 0) {
                  try {
                    const parsed = JSON.parse(body);
                    if (parsed && (parsed.batches || Array.isArray(parsed))) {
                      fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2), 'utf-8');
                      cmd = `python "${scriptPath}" --json-input "${jsonPath}" --output "${outPath}"`;
                    }
                  } catch (e) {
                    console.warn('Failed to parse JSON body for geomar v2 export:', e);
                  }
                }
                
                exec(cmd, { maxBuffer: 1024 * 1024 * 32 }, (error, stdout, stderr) => {
                  if (stdout) console.log('Python export stdout:', stdout);
                  if (stderr) console.error('Python export stderr:', stderr);
                  if (error) {
                    console.error('Python export error:', error);
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: error.message }));
                    return;
                  }
                  
                  const targetFile = fs.existsSync(outPath) ? outPath : (fs.existsSync(altOutPath) ? altOutPath : null);
                  if (targetFile) {
                    const data = fs.readFileSync(targetFile);
                    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    res.setHeader('Content-Disposition', 'attachment; filename="Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2.xlsx"');
                    res.statusCode = 200;
                    res.end(data);
                  } else {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'Output file not generated' }));
                  }
                });
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
