/**
 * server.js — ForecastAI Backend
 * ================================
 * Express server: auth, forecast, intelligence, scenario, copilot, audit
 */
'use strict';

require('dotenv').config();
const { execFile } = require('child_process');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const os = require('os');
const fs = require('fs');
const db = require('./db');

/* ── Startup env validation ───────────────────────────────────────────────── */
const REQUIRED_ENV = ['JWT_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('[startup] JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 4000;

/* ── Trust proxy (required when deployed behind nginx / cloud load balancer) */
app.set('trust proxy', 1);

/* ── CORS ─────────────────────────────────────────────────────────────────── */
// Build allowed origins list from env + always allow localhost for dev
const ALLOWED_ORIGINS = new Set([
  'http://localhost:4000',
  'http://127.0.0.1:4000',
]);
// Accept comma-separated list: FRONTEND_URL=https://myapp.com,https://www.myapp.com
(process.env.FRONTEND_URL || '')
  .split(',')
  .map(u => u.trim())
  .filter(Boolean)
  .forEach(u => ALLOWED_ORIGINS.add(u));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);           // server-to-server / curl
    if (origin === 'null') return callback(null, true); // file:// in dev
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));

/* ── Rate limiters ────────────────────────────────────────────────────────── */
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  message: { error: 'Too many OTP requests. Please wait 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
});
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many verification attempts. Please wait.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: { error: 'Too many requests. Please slow down.' },
});

/* ── Routes ───────────────────────────────────────────────────────────────── */
const authRouter = require('./routes/auth');
const intelligenceRouter = require('./routes/intelligence');
const adminRouter = require('./routes/admin');
const procurementRouter = require('./routes/procurement');
const { requireAuth, authorize } = require('./middleware/auth');

app.use('/api/auth/login', verifyLimiter);
app.use('/api/intelligence', apiLimiter);

app.use('/api/auth', authRouter);
app.use('/api/intelligence', intelligenceRouter);
app.use('/api/admin', adminRouter);
app.use('/api/procurement', requireAuth, procurementRouter);

/* ── Health ───────────────────────────────────────────────────────────────── */
app.get('/api/health', async (req, res) => {
  const checks = { status: 'ok', time: new Date().toISOString(), version: '2.0.0' };
  try {
    const result = await runPython({ mode: 'health' }, 5000);
    checks.python = result.status || 'ok';
  } catch (_) {
    checks.python = 'unavailable';
    checks.status = 'degraded';
  }
  res.status(checks.status === 'ok' ? 200 : 503).json(checks);
});

/* ── Python runner helper ─────────────────────────────────────────────────── */
// Resolve python executable: env override → 'python3' (Linux/Mac) → 'python' → 'py' (Windows)
function getPythonCmd() {
  if (process.env.PYTHON_CMD) return process.env.PYTHON_CMD;
  if (process.platform === 'win32') return 'py';
  return 'python3';
}
const PYTHON_CMD = getPythonCmd();

function runPython(inputObj, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON_CMD, [path.join(__dirname, 'rf_model.py'), JSON.stringify(inputObj)],
      { cwd: __dirname, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          try {
            const result = JSON.parse(stdout.trim());
            if (result.error) return reject(new Error(result.error));
          } catch (_) {}
          return reject(new Error(stderr || error.message));
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) return reject(new Error(result.error));
          resolve(result);
        } catch (e) {
          reject(new Error(`Model parse error: ${stdout.slice(0, 200)}`));
        }
      }
    );
  });
}

function runPythonForUser(inputObj, userId, timeoutMs = 30000, datasetId) {
  const datasets = db.listDatasets(userId);
  if (!datasets.length) return runPython(inputObj, timeoutMs);
  const preferences = db.getUserPreferences(userId);
  const dataset = datasets.find(item => item.id === datasetId) || datasets.find(item => item.id === preferences.activeDatasetId) || datasets[0];
  const tempPath = path.join(__dirname, `_user_${Date.now()}_${Math.random().toString(16).slice(2)}.csv`);
  const csvValue = value => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  fs.writeFileSync(tempPath, [dataset.headers.join(','), ...dataset.rows.map(row => dataset.headers.map(header => csvValue(row[header])).join(','))].join('\n'), 'utf8');
  return runPython({ ...inputObj, csv_path: tempPath }, timeoutMs).finally(() => {
    try { fs.unlinkSync(tempPath); } catch (_) { }
  });
}

/* ── POST /api/forecast ───────────────────────────────────────────────────── */
app.post('/api/forecast', requireAuth, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { sales, inventory, price, month, lead_time, mode, datasetId, model } = req.body;
  if (sales === undefined || inventory === undefined || price === undefined || month === undefined) {
    return res.status(400).json({ error: 'sales, inventory, price, and month are required.' });
  }
  try {
    const result = await runPythonForUser({
      mode: mode || 'forecast',
      sales: Number(sales),
      inventory: Number(inventory),
      price: Number(price),
      month: Number(month),
      lead_time: Number(lead_time || 7),
      model: db.getUserPreferences(req.user.id).activeModel || 'Random Forest',
    }, req.user.id, 30000, datasetId);
    res.json(result);
  } catch (err) {
    console.error('[forecast]', err.message);
    res.status(422).json({ success: false, error: { code: 'MODEL_TRAINING_FAILED', message: err.message || 'The forecast model could not process this input.' } });
  }
});

/* ── POST /api/upload-forecast ────────────────────────────────────────────── */
app.post('/api/upload-forecast', requireAuth, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No dataset rows provided.' });
  }

  const last = rows[rows.length - 1];
  const { sales, inventory, price, month } = last;
  if ([sales, inventory, price, month].some(v => v === undefined || isNaN(Number(v)))) {
    return res.status(400).json({ error: 'Last row must have valid sales, inventory, price, month values.' });
  }

  // Write temp CSV to backend dir (avoids spaces in Windows %TEMP% path)
  const tmpPath = path.join(__dirname, `_upload_${Date.now()}.csv`);
  const headers = Object.keys(rows[0]).join(',');
  const csvLines = rows.map(r => Object.values(r).join(','));
  const csvContent = [headers, ...csvLines].join('\n');
  fs.writeFileSync(tmpPath, csvContent, 'utf8');

  try {
    const result = await runPython({
      mode: 'full',
      sales: Number(sales),
      inventory: Number(inventory),
      price: Number(price),
      month: Number(month),
      lead_time: Number(last.lead_time || 7),
      csv_path: tmpPath,
    });
    try { fs.unlinkSync(tmpPath); } catch (_) { }
    res.json({ ...result, rows_used: rows.length });
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { }
    console.error('[upload-forecast]', err.message);
    res.status(500).json({ error: 'Forecast model failed.', detail: err.message });
  }
});

/* ── POST /api/data-quality ───────────────────────────────────────────────── */
app.post('/api/data-quality', requireAuth, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { rows } = req.body;
  let tmpPath = null;

  try {
    if (rows === undefined) {
      const datasets = db.listDatasets(req.user.id);
      if (datasets.length) {
        const dataset = datasets[0];
        const csvValue = value => {
          const text = String(value ?? '');
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        tmpPath = path.join(__dirname, `_quality_${Date.now()}.csv`);
        fs.writeFileSync(tmpPath, [dataset.headers.join(','), ...dataset.rows.map(row => dataset.headers.map(header => csvValue(row[header])).join(','))].join('\n'), 'utf8');
      }
    } else {
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, error: { code: 'EMPTY_DATASET', message: 'The uploaded CSV contains no data rows.' } });
      }
      const headers = Object.keys(rows[0]);
      const csvValue = value => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const csvLines = rows.map(row => headers.map(header => csvValue(row[header])).join(','));
      tmpPath = path.join(__dirname, `_quality_${Date.now()}.csv`);
      fs.writeFileSync(tmpPath, [headers.join(','), ...csvLines].join('\n'), 'utf8');
    }

    const result = await runPython({
      mode: 'quality',
      csv_path: tmpPath || path.join(__dirname, 'data.csv'),
    });
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (_) { }
    res.json(result);
  } catch (err) {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (_) { }
    res.status(500).json({ error: 'Quality analysis failed.', detail: err.message });
  }
});

/* ── POST /api/scenario ───────────────────────────────────────────────────── */
app.post('/api/scenario', requireAuth, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { sales, inventory, price, month, lead_time, scenarios } = req.body;
  if (!scenarios || !Array.isArray(scenarios)) {
    return res.status(400).json({ error: 'scenarios[] array is required.' });
  }
  try {
    const result = await runPython({
      mode: 'scenario',
      sales: Number(sales || 500),
      inventory: Number(inventory || 800),
      price: Number(price || 5000),
      month: Number(month || 6),
      lead_time: Number(lead_time || 7),
      scenarios,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Scenario simulation failed.', detail: err.message });
  }
});

/* ── GET /api/models ──────────────────────────────────────────────────────── */
app.get('/api/models', requireAuth, authorize('ADMIN'), async (req, res) => {
  try {
    const result = await runPython({ mode: 'compare' }, 45000);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Model comparison failed.', detail: err.message });
  }
});

/* ── 404 ──────────────────────────────────────────────────────────────────── */
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

/* ── Global error handler ─────────────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

/* ── Start ────────────────────────────────────────────────────────────────── */
const server = app.listen(PORT, () => {
  console.log(`\n🚀 ForecastAI backend v2.0 running on http://localhost:${PORT}`);
  console.log(`   Health:       GET  http://localhost:${PORT}/api/health`);
  console.log(`   Forecast:     POST http://localhost:${PORT}/api/forecast`);
  console.log(`   Dashboard:    GET  http://localhost:${PORT}/api/intelligence/dashboard`);
  console.log(`   Models:       GET  http://localhost:${PORT}/api/models`);
  console.log(`   Copilot:      POST http://localhost:${PORT}/api/intelligence/copilot\n`);
  const origins = [...ALLOWED_ORIGINS].join(', ');
  console.log(`   CORS origins: ${origins}\n`);
});

/* ── Graceful shutdown ────────────────────────────────────────────────────── */
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  server.close(() => {
    console.log('[shutdown] HTTP server closed.');
    process.exit(0);
  });
  // Force exit after 10s if connections hang
  setTimeout(() => { console.error('[shutdown] Forced exit.'); process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
