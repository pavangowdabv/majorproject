/**
 * routes/intelligence.js
 * ========================
 * All enterprise AI intelligence endpoints:
 *
 *   GET  /api/intelligence/dashboard   — KPIs + action summary for Command Center
 *   GET  /api/intelligence/products    — all products with risk scores + recommendations
 *   GET  /api/intelligence/product/:id — single SKU deep analysis
 *   POST /api/intelligence/scenario    — scenario simulation via Python
 *   GET  /api/intelligence/models      — model comparison results
 *   GET  /api/intelligence/audit       — audit log (read)
 *   POST /api/intelligence/audit       — append audit entry
 *   POST /api/intelligence/action      — approve / reject / snooze a recommendation
 *   POST /api/intelligence/copilot     — AI copilot query
 *   POST /api/intelligence/quality     — data quality analysis
 *   POST /api/intelligence/explain     — SHAP explanation for a product
 */

'use strict';

const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth, authorize } = require('../middleware/auth');

const router = express.Router();
const RF_MODEL = path.join(__dirname, '..', 'rf_model.py');
const DATA_CSV = path.join(__dirname, '..', 'data.csv');
const AUDIT_FILE = path.join(__dirname, '..', 'audit.json');
const PRODUCT_FORECAST_CACHE = new Map();
const PRODUCT_FORECAST_PENDING = new Map();
const PRODUCT_FORECAST_TTL_MS = 300000;

function cleanupTemporaryModelSnapshots() {
  const backendDir = path.join(__dirname, '..');
  for (const name of fs.readdirSync(backendDir)) {
    if (!/^_user_model_.*\.csv$/.test(name)) continue;
    try { fs.unlinkSync(path.join(backendDir, name)); } catch (_) { /* best effort */ }
  }
}

cleanupTemporaryModelSnapshots();

function loadDatasetRows() {
  if (!fs.existsSync(DATA_CSV)) return [];
  const lines = fs.readFileSync(DATA_CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(value => value.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.reduce((row, header, index) => {
      const value = (values[index] || '').trim();
      row[header] = ['sales', 'inventory', 'price', 'month', 'demand', 'lead_time'].includes(header) ? Number(value) : value;
      return row;
    }, {});
  }).filter(row => row.product);
}

router.use(requireAuth);

// ── Python runner ────────────────────────────────────────────────────────────
function runPython(inputObj, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const modelInput = { ...inputObj };
    const datasetRows = modelInput.__datasetRows;
    delete modelInput.__datasetRows;
    let temporaryPath = null;
    if (Array.isArray(datasetRows) && datasetRows.length) {
      temporaryPath = path.join(__dirname, `../_user_model_${Date.now()}_${Math.random().toString(16).slice(2)}.csv`);
      const headers = Object.keys(datasetRows[0]);
      const csvValue = value => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      fs.writeFileSync(temporaryPath, [headers.join(','), ...datasetRows.map(row => headers.map(header => csvValue(row[header])).join(','))].join('\n'), 'utf8');
      modelInput.csv_path = temporaryPath;
    }
    const PYTHON_CMD = process.env.PYTHON_CMD || (process.platform === 'win32' ? 'py' : 'python3');
    const inputStr = JSON.stringify(modelInput);
    execFile(PYTHON_CMD, [RF_MODEL, inputStr], { cwd: path.dirname(RF_MODEL), timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (temporaryPath) try { fs.unlinkSync(temporaryPath); } catch (_) { }
        if (error) {
          try {
            const pythonResult = JSON.parse(stdout.trim());
            if (pythonResult.error) return reject(new Error(pythonResult.error));
          } catch (_) { }
          return reject(new Error(stderr || error.message));
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) return reject(new Error(result.error));
          resolve(result);
        } catch (e) {
          reject(new Error(`Model output parse error: ${stdout.slice(0, 200)}`));
        }
      }
    );
  });
}

function runPythonForUser(inputObj, userId, timeoutMs = 30000, datasetId) {
  return runPython({ ...inputObj, __datasetRows: getUserDatasetRows(userId, datasetId) }, timeoutMs);
}

// ── Audit log helpers ────────────────────────────────────────────────────────
function loadAudit() {
  if (!fs.existsSync(AUDIT_FILE)) {
    fs.writeFileSync(AUDIT_FILE, JSON.stringify([], null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
  } catch (_) { return []; }
}

function saveAudit(entries) {
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(entries, null, 2));
}

function appendAudit(entry) {
  const entries = loadAudit();
  entries.unshift({ id: `audit_${Date.now()}`, timestamp: new Date().toISOString(), ...entry });
  // Keep last 500 entries
  if (entries.length > 500) entries.splice(500);
  saveAudit(entries);
  return entries[0];
}

// ── Product catalogue (source of truth for inventory data) ──────────────────
function getProductCatalogue(sourceRows = loadDatasetRows()) {
  const rows = sourceRows;
  const latest = new Map();
  rows.forEach(row => latest.set(row.product, row));
  return [...latest.values()].map(row => ({
    id: row.product.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    name: row.product,
    category: row.category || 'Uncategorized',
    sales: Number(row.sales),
    inventory: Number(row.inventory),
    price: Number(row.price),
    month: Number(row.month),
    lead_time: Number(row.lead_time) || 7,
    cost_per_unit: Number.isFinite(Number(row.cost_per_unit)) ? Number(row.cost_per_unit) : null,
  }));
}

function getUserDatasetRows(userId, datasetId) {
  const saved = db.listDatasets(userId);
  if (datasetId) {
    const selected = saved.find(dataset => dataset.id === datasetId);
    if (!selected) throw new Error('Dataset not found.');
    return selected.rows;
  }
  const activeId = db.getUserPreferences(userId).activeDatasetId;
  const active = saved.find(dataset => dataset.id === activeId);
  return active?.rows || (saved.length ? saved[0].rows : loadDatasetRows());
}

function getActiveModel(userId) {
  return db.getUserPreferences(userId).activeModel || 'Random Forest';
}

function getActiveDatasetId(userId) {
  const preferences = db.getUserPreferences(userId);
  return preferences.activeDatasetId || db.listDatasets(userId)[0]?.id || null;
}

function getDatasetSignature(userId) {
  const rows = getUserDatasetRows(userId);
  if (!rows.length) return `default:${path.basename(DATA_CSV)}`;
  const keyParts = rows.slice(0, 4).map(row => `${row.product || 'row'}:${row.sales ?? ''}:${row.inventory ?? ''}:${row.price ?? ''}:${row.month ?? ''}:${row.lead_time ?? ''}`);
  return `rows:${rows.length}:${rows[0]?.product || 'n/a'}:${rows[rows.length - 1]?.product || 'n/a'}:${keyParts.join('|')}`;
}

async function getCachedEnrichedProducts(userId) {
  const hasUserDataset = db.listDatasets(userId).length > 0;
  const signature = getDatasetSignature(userId);
  const activeModel = getActiveModel(userId);
  const cacheScope = hasUserDataset ? userId : 'default';
  const cacheKey = `${cacheScope}:${activeModel}:${signature}`;
  const now = Date.now();
  const cached = PRODUCT_FORECAST_CACHE.get(cacheKey);
  if (cached && now - cached.timestamp < PRODUCT_FORECAST_TTL_MS) {
    return cached.products;
  }

  const pending = PRODUCT_FORECAST_PENDING.get(cacheKey);
  if (pending) return pending;

  const products = getProductCatalogue(getUserDatasetRows(userId));
  const forecastPromise = runPythonForUser({
    mode: 'batch',
    model: activeModel,
    items: products,
  }, userId).then(result => {
    if (!Array.isArray(result.forecasts) || result.forecasts.length !== products.length) {
      throw new Error('The forecast model returned an incomplete batch result.');
    }
    const forecasts = products.map((product, index) => ({
      product,
      ...calculateRisk(product, result.forecasts[index]),
    }));
    PRODUCT_FORECAST_CACHE.set(cacheKey, { products: forecasts, timestamp: Date.now() });
    return forecasts;
  }).finally(() => {
    PRODUCT_FORECAST_PENDING.delete(cacheKey);
  });
  PRODUCT_FORECAST_PENDING.set(cacheKey, forecastPromise);
  return forecastPromise;
}

setImmediate(() => {
  getCachedEnrichedProducts('__default_forecast_warmup__')
    .catch(error => console.error('[forecast warmup]', error.message));
});

// ── Risk calculation (transparent, traceable) ────────────────────────────────
function calculateRisk(product, forecastResult) {
  const { inventory, lead_time, cost_per_unit, price } = product;
  const predicted = forecastResult.predicted_demand || 0;
  const lower = Number.isFinite(forecastResult.prediction_interval?.lower)
    ? forecastResult.prediction_interval.lower : predicted;
  const upper = Number.isFinite(forecastResult.prediction_interval?.upper)
    ? forecastResult.prediction_interval.upper : predicted;

  // Coverage: how many days of inventory do we have
  const dailyDemand = predicted / 30;
  const coverageDays = dailyDemand > 0 ? Math.round(inventory / dailyDemand) : 999;

  // Safety stock = Z(0.95) × std_dev of demand × sqrt(lead_time)
  // Using prediction interval spread as proxy for demand std_dev
  const demandStd = (upper - lower) / (2 * 1.645);
  const safetyStock = Math.round(1.645 * demandStd * Math.sqrt(lead_time));
  const reorderPoint = Math.round(dailyDemand * lead_time + safetyStock);

  // Stockout probability: P(inventory < demand) modelled via normal approximation
  const z_stockout = demandStd > 0 ? (inventory - predicted) / demandStd : 3;
  const stockoutProb = Math.max(0, Math.min(100,
    Math.round((1 - normalCDF(z_stockout)) * 100)
  ));

  // Overstock probability: inventory significantly exceeds upper bound of demand
  const overstockProb = Math.max(0, Math.min(100,
    Math.round(normalCDF((inventory - upper) / Math.max(demandStd, 1)) * 100)
  ));

  // Demand volatility: coefficient of variation from interval
  const demandCV = predicted > 0 ? Math.round((demandStd / predicted) * 100) : 0;

  // Forecast confidence from model MAPE
  const mape = Number.isFinite(forecastResult.model_metrics?.mape) ? forecastResult.model_metrics.mape : null;
  const confidence = mape === null ? null : Math.max(0, Math.min(100, Math.round(100 - mape)));

  // Composite risk score (0-100) — weighted
  const riskScore = Math.round(
    stockoutProb * 0.45 +
    Math.min(100, (lead_time / 30) * 100) * 0.20 +
    demandCV * 0.20 +
    (confidence === null ? 0 : 100 - confidence) * 0.15
  );

  const riskLevel =
    riskScore >= 70 ? 'critical' :
      riskScore >= 45 ? 'high' :
        riskScore >= 25 ? 'medium' : 'low';

  const riskReasons = [];
  if (confidence !== null && confidence < 70) riskReasons.push('Forecast confidence is below 70%.');
  if (demandCV >= 30) riskReasons.push('Demand volatility is elevated.');
  if (stockoutProb >= 40) riskReasons.push(`Stockout probability is ${stockoutProb}%.`);
  if (coverageDays < lead_time) riskReasons.push(`Inventory coverage (${coverageDays}d) is below lead time (${lead_time}d).`);
  if (overstockProb >= 50) riskReasons.push(`Inventory exceeds the forecast range (${overstockProb}% overstock probability).`);
  if (!riskReasons.length) riskReasons.push('Inventory coverage and forecast uncertainty are within healthy thresholds.');

  // Recommended order quantity (Economic Order Quantity simplified)
  const orderQty = Math.max(0, Math.round(predicted + safetyStock - inventory));

  // Recommended action
  let action, actionReason;
  if (stockoutProb >= 70) {
    action = 'REORDER_NOW';
    actionReason = `${stockoutProb}% stockout risk. ${coverageDays} days of stock remaining (lead time: ${lead_time}d).`;
  } else if (stockoutProb >= 40) {
    action = 'REORDER_SOON';
    actionReason = `Moderate stockout risk (${stockoutProb}%). Consider ordering within ${Math.max(1, coverageDays - lead_time)} days.`;
  } else if (overstockProb >= 70) {
    action = 'REDUCE_ORDER';
    actionReason = `${overstockProb}% overstock probability. Current stock exceeds forecasted demand upper bound.`;
  } else if (overstockProb >= 40) {
    action = 'MONITOR';
    actionReason = `Mild overstock risk (${overstockProb}%). Monitor demand before next order.`;
  } else {
    action = 'HOLD';
    actionReason = `Inventory healthy. ${coverageDays} days coverage against ${predicted} unit forecast.`;
  }

  // Revenue at risk
  const revenueAtRisk = stockoutProb > 20
    ? Math.round(Math.max(0, predicted - inventory) * price * (stockoutProb / 100))
    : 0;

  // Excess inventory value
  const excessUnits = Math.max(0, inventory - upper);
  const excessValue = Number.isFinite(cost_per_unit) ? Math.round(excessUnits * cost_per_unit) : null;

  return {
    predicted_demand: predicted,
    prediction_interval: forecastResult.prediction_interval,
    inventory_coverage_days: coverageDays,
    safety_stock: safetyStock,
    reorder_point: reorderPoint,
    daily_demand: Math.round(dailyDemand * 10) / 10,
    stockout_probability: stockoutProb,
    overstock_probability: overstockProb,
    demand_volatility_cv: demandCV,
    forecast_confidence: confidence,
    forecast_uncertainty: forecastResult.prediction_interval ? {
      standard_deviation: forecastResult.prediction_interval.std,
      interval_width: Math.round((upper - lower) * 100) / 100,
      confidence: forecastResult.prediction_interval.confidence,
    } : null,
    expected_value: predicted * price,
    expected_profit: Number.isFinite(cost_per_unit) ? predicted * Math.max(0, price - cost_per_unit) : null,
    risk_score: riskScore,
    risk_level: riskLevel,
    risk_reasons: riskReasons,
    decision_risk: riskLevel.toUpperCase(),
    recommended_order_qty: Math.max(0, orderQty),
    recommended_action: action,
    action_reason: actionReason,
    revenue_at_risk: revenueAtRisk,
    excess_inventory_value: excessValue,
    model_metrics: forecastResult.model_metrics,
    feature_contributions: forecastResult.feature_contributions || [],
  };
}

// ── Intelligence orchestration endpoints ──────────────────────────────────
async function getEnrichedProducts(userId) {
  return getCachedEnrichedProducts(userId);
}

router.get('/model-health', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const comparison = await runPythonForUser({ mode: 'compare' }, req.user.id, 45000, req.query.datasetId);
    const activeName = getActiveModel(req.user.id);
    const active = comparison.models.find(model => model.model === activeName) || comparison.models[0];
    const best = comparison.models.find(model => model.model === comparison.best_model) || comparison.models[0];
    const performanceChange = active && best ? Math.round(((active.rmse - best.rmse) / Math.max(active.rmse, 0.01)) * 1000) / 10 : 0;
    res.json({
      current_model: active?.model || null,
      status: best && active && best.model !== active.model && best.rmse < active.rmse ? 'degraded' : 'healthy',
      current_metrics: active || null,
      recommended_model: best?.model || null,
      performance_change_percent: performanceChange,
      drift: { data: null, prediction: null, note: 'Drift requires a persisted baseline; no baseline is available yet.' },
      retraining: { required: Boolean(best && active && best.model !== active.model), activated: false },
      dataset_id: req.query.datasetId || getActiveDatasetId(req.user.id),
      models: comparison.models,
      evaluated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(422).json({ error: 'Model health analysis could not be completed.', detail: err.message });
  }
});

router.post('/retrain', authorize('ADMIN'), async (req, res) => {
  try {
    const comparison = await runPythonForUser({ mode: 'compare' }, req.user.id, 45000);
    const winner = comparison.models.reduce((best, model) => model.rmse < best.rmse ? model : best, comparison.models[0]);
    res.json({ activated: false, selected_model: winner?.model || null, reason: 'A model is activated only after a persisted baseline validation is available.', comparison });
  } catch (err) {
    res.status(422).json({ error: 'Retraining validation failed.', detail: err.message });
  }
});

router.get('/digital-twin', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const products = await getEnrichedProducts(req.user.id);
    res.json({
      generated_at: new Date().toISOString(), products: products.map(item => ({
        id: item.product.id, name: item.product.name, inventory: item.product.inventory,
        predicted_demand: item.predicted_demand, projected_inventory: Math.max(0, Math.round(item.product.inventory - item.predicted_demand)),
        lead_time: item.product.lead_time, reorder_point: item.reorder_point, safety_stock: item.safety_stock,
        stockout_probability: item.stockout_probability, overstock_probability: item.overstock_probability,
        risk_level: item.risk_level, risk_reasons: item.risk_reasons,
      }))
    });
  } catch (err) { res.status(422).json({ error: 'Digital twin could not be generated from the active dataset.', detail: err.message }); }
});

router.get('/risk', async (req, res) => {
  try {
    const products = await getEnrichedProducts(req.user.id);
    res.json({ generated_at: new Date().toISOString(), products: products.map(item => ({ product_id: item.product.id, product_name: item.product.name, decision_risk: item.decision_risk, confidence: item.forecast_confidence, stockout_probability: item.stockout_probability, overstock_probability: item.overstock_probability, reasons: item.risk_reasons })) });
  } catch (err) { res.status(422).json({ error: 'Risk assessment could not be completed from the active dataset.', detail: err.message }); }
});

router.post('/simulate', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { product_id, demand_change = 0, inventory_change = 0, supplier_delay = 0, price_change = 0 } = req.body;
    if (![demand_change, inventory_change, supplier_delay, price_change].every(value => Number.isFinite(Number(value)))) return res.status(400).json({ error: 'Scenario changes must be numeric.' });
    const products = await getEnrichedProducts(req.user.id);
    const selected = products.find(item => item.product.id === product_id) || products[0];
    if (!selected) return res.status(422).json({ error: 'Simulation could not be completed because inventory data is missing.' });
    const demand = Math.max(0, selected.predicted_demand * (1 + Number(demand_change) / 100));
    const inventory = Math.max(0, selected.product.inventory * (1 + Number(inventory_change) / 100));
    const leadTime = Math.max(1, selected.product.lead_time + Number(supplier_delay));
    const stockout = Math.max(0, Math.min(100, Math.round((demand + selected.safety_stock * (leadTime / Math.max(selected.product.lead_time, 1)) - inventory) / Math.max(demand, 1) * 100)));
    const price = selected.product.price * (1 + Number(price_change) / 100);
    res.json({ product: selected.product.name, current: { expected_demand: selected.predicted_demand, inventory: selected.product.inventory, stockout_probability: selected.stockout_probability }, simulated: { expected_demand: Math.round(demand), inventory: Math.round(inventory), stockout_probability: stockout, overstock_probability: Math.max(0, Math.min(100, Math.round((inventory - demand) / Math.max(demand, 1) * 100))), expected_cost: Math.round(Math.max(0, demand + selected.safety_stock - inventory) * (selected.product.cost_per_unit || price)), expected_revenue: Math.round(demand * price), recommended_order_quantity: Math.max(0, Math.round(demand + selected.safety_stock - inventory)), lead_time: leadTime }, inputs: { demand_change, inventory_change, supplier_delay, price_change } });
  } catch (err) { res.status(422).json({ error: 'Simulation could not be completed from the active dataset.', detail: err.message }); }
});

router.get('/agents', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const products = await getEnrichedProducts(req.user.id);
    const urgent = products.filter(item => item.stockout_probability >= 40).sort((a, b) => b.risk_score - a.risk_score);
    const totalOrder = urgent.reduce((sum, item) => sum + item.recommended_order_qty, 0);
    const decision = urgent.length ? (urgent.some(item => item.stockout_probability >= 70) ? 'URGENT REORDER' : 'REORDER') : 'MONITOR';
    res.json({ generated_at: new Date().toISOString(), agents: { demand: { outlook: products.length ? 'Calculated from current forecast distribution.' : 'No data', recommendation: urgent.length ? 'Demand requires inventory review.' : 'Demand is within current capacity.' }, inventory: { status: urgent.length ? 'Below target for some SKUs.' : 'Coverage is adequate.', recommended_order_quantity: totalOrder }, risk: { level: urgent.some(item => item.risk_level === 'critical') ? 'CRITICAL' : urgent.length ? 'HIGH' : 'LOW', factors: urgent.slice(0, 5).flatMap(item => item.risk_reasons) }, finance: { estimated_purchase_value: Math.round(urgent.reduce((sum, item) => sum + item.recommended_order_qty * (item.product.cost_per_unit || item.product.price), 0)), potential_lost_sales: Math.round(urgent.reduce((sum, item) => sum + item.revenue_at_risk, 0)) }, decision: { action: decision, quantity: totalOrder, confidence: Math.round(products.reduce((sum, item) => sum + (item.forecast_confidence || 0), 0) / Math.max(products.length, 1)), reasoning: urgent.length ? 'The decision prioritizes products whose calculated demand exceeds available inventory.' : 'No calculated stockout threshold requires immediate action.' } }, source: 'Deterministic analytical agents over the active dataset' });
  } catch (err) { res.status(422).json({ error: 'Agent analysis could not be completed.', detail: err.message }); }
});

router.post('/optimize', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const budget = Number(req.body.budget);
    if (!Number.isFinite(budget) || budget < 0) return res.status(400).json({ error: 'budget must be a non-negative number.' });
    const products = (await getEnrichedProducts(req.user.id)).sort((a, b) => b.risk_score - a.risk_score);
    let remaining = budget;
    const allocation = products.map(item => { const unitCost = item.product.cost_per_unit || item.product.price; const desired = item.recommended_order_qty; const quantity = Math.min(desired, Math.floor(remaining / Math.max(unitCost, 0.01))); const spend = Math.round(quantity * unitCost); remaining -= spend; return { product: item.product.name, quantity, spend, unit_cost: unitCost, risk_before: item.stockout_probability, rationale: `${item.risk_score >= 45 ? 'Elevated risk' : 'Demand coverage'} and forecast demand drove this priority.` }; });
    res.json({ budget, recommended_spend: budget - remaining, remaining_budget: remaining, allocation, source: 'Calculated from active forecasts, inventory and product costs' });
  } catch (err) { res.status(422).json({ error: 'Optimization could not satisfy the budget constraints.', detail: err.message }); }
});

// Standard normal CDF approximation (Abramowitz & Stegun)
function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z >= 0 ? 1 - p : p;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/intelligence/dashboard
// ════════════════════════════════════════════════════════════════════════════
router.get('/dashboard', async (req, res) => {
  try {
    const products = getProductCatalogue(getUserDatasetRows(req.user.id));
    const cached = await getCachedEnrichedProducts(req.user.id);
    const enriched = cached
      .map(item => ({
        ...item.product,
        ...item,
        risk_level: item.risk_level || 'unknown',
      }))
      .filter(p => p && p.name);

    // KPI aggregates
    const totalRevenue = enriched.reduce((s, p) => s + p.sales * p.price, 0);
    const totalRisk = enriched.reduce((s, p) => s + p.revenue_at_risk, 0);
    const criticalCount = enriched.filter(p => p.risk_level === 'critical').length;
    const highCount = enriched.filter(p => p.risk_level === 'high').length;
    const mediumCount = enriched.filter(p => p.risk_level === 'medium').length;
    const lowCount = enriched.filter(p => p.risk_level === 'low').length;
    const overstockCount = enriched.filter(p => p.overstock_probability > 50).length;
    const avgConfidence = Math.round(enriched.reduce((s, p) => s + (p.forecast_confidence || 0), 0) / enriched.length);
    const totalDemand = enriched.reduce((s, p) => s + (p.predicted_demand || 0), 0);
    const inventoryValue = enriched.reduce((s, p) => s + (p.inventory || 0) * (p.cost_per_unit || p.price || 0), 0);

    // Action items
    const actions = enriched
      .filter(p => p.recommended_action !== 'HOLD')
      .sort((a, b) => b.risk_score - a.risk_score)
      .map(p => ({
        product_id: p.id,
        product_name: p.name,
        category: p.category,
        action: p.recommended_action,
        reason: p.action_reason,
        risk_level: p.risk_level,
        risk_score: p.risk_score,
        revenue_at_risk: p.revenue_at_risk,
        status: 'pending'
      }));

    res.json({
      kpis: {
        total_revenue: Math.round(totalRevenue),
        predicted_demand: Math.round(totalDemand),
        revenue_at_risk: Math.round(totalRisk),
        critical_skus: criticalCount,
        high_risk_skus: highCount,
        medium_risk_skus: mediumCount,
        low_risk_skus: lowCount,
        overstock_skus: overstockCount,
        avg_forecast_confidence: avgConfidence,
        inventory_value: Math.round(inventoryValue),
        action_items: actions.length,
      },
      products: enriched.map(p => ({
        id: p.id, name: p.name, category: p.category,
        inventory: p.inventory, sales: p.sales,
        predicted_demand: p.predicted_demand,
        risk_level: p.risk_level, risk_score: p.risk_score,
        stockout_probability: p.stockout_probability,
        recommended_action: p.recommended_action,
        revenue_at_risk: p.revenue_at_risk,
      })),
      action_items: actions,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[dashboard]', err.message);
    res.status(500).json({ error: 'Failed to generate dashboard data.', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/intelligence/products
// ════════════════════════════════════════════════════════════════════════════
router.get('/products', async (req, res) => {
  try {
    const enriched = (await getCachedEnrichedProducts(req.user.id)).map(item => ({
      ...item.product,
      ...item,
      risk_level: item.risk_level || 'unknown',
      current_action: db.findAction(item.product.id, req.user.id),
    }));

    res.json({ products: enriched, count: enriched.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load products.', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/intelligence/product/:id
// ════════════════════════════════════════════════════════════════════════════
router.get('/product/:id', async (req, res) => {
  try {
    const products = getProductCatalogue(getUserDatasetRows(req.user.id, req.query.datasetId));
    const product = products.find(p => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: `No forecast is available for ${req.params.id} in the selected dataset. Generate a forecast first.` });

    const [forecast, explanation] = await Promise.all([
      runPythonForUser({ mode: 'forecast', model: getActiveModel(req.user.id), ...product }, req.user.id, 30000, req.query.datasetId),
      runPythonForUser({ mode: 'explain', model: getActiveModel(req.user.id), ...product }, req.user.id, 30000, req.query.datasetId).catch(() => ({})),
    ]);

    const risk = calculateRisk(product, forecast);
    const audit = loadAudit().filter(a => a.product_id === product.id).slice(0, 10);

    const history = getUserDatasetRows(req.user.id).filter(row => row.product === product.name);
    const historyDates = history.map(row => new Date(row.date || row.timestamp || (row.year && row.month ? `${row.year}-${String(row.month).padStart(2, '0')}-01` : ''))).filter(date => !Number.isNaN(date.getTime()));
    const latestHistoryDate = historyDates.length ? new Date(Math.max(...historyDates.map(date => date.getTime()))) : null;
    const forecastStartDate = latestHistoryDate ? new Date(latestHistoryDate.getTime() + 86400000).toISOString().slice(0, 10) : null;
    res.json({
      product,
      history,
      forecast_start_date: forecastStartDate,
      risk,
      explanation: {
        feature_contributions: explanation.feature_contributions,
        feature_importance: explanation.feature_importance,
        baseline_prediction: explanation.baseline_prediction,
        trend: explanation.trend,
        model_note: explanation.model_note,
      },
      audit_history: audit,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load product analysis.', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/intelligence/scenario
// ════════════════════════════════════════════════════════════════════════════
router.post('/scenario', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { product_id, scenarios } = req.body;
    if (!product_id || !Array.isArray(scenarios) || scenarios.length === 0) {
      return res.status(400).json({ error: 'product_id and scenarios[] are required.' });
    }

    const datasetId = req.body.datasetId || getActiveDatasetId(req.user.id);
    if (datasetId && !db.findDataset(datasetId, req.user.id)) {
      return res.status(404).json({ error: 'The selected dataset is no longer available.' });
    }
    const products = getProductCatalogue(getUserDatasetRows(req.user.id, datasetId));
    const product = products.find(p => p.id === product_id);
    if (!product) return res.status(404).json({ error: `No forecast is available for ${product_id} in the selected dataset. Generate a baseline forecast first.` });

    const result = await runPythonForUser({
      mode: 'scenario',
      model: getActiveModel(req.user.id),
      ...product,
      scenarios,
    }, req.user.id, 30000, datasetId);

    // Enrich each scenario with risk info
    const baselineRisk = calculateRisk(product, {
      predicted_demand: result.baseline.predicted_demand,
      prediction_interval: result.baseline.prediction_interval,
      model_metrics: result.model_metrics,
    });
    const enrichedScenarios = result.scenarios.map(sc => {
      const scenarioChanges = (sc.applied_changes || []).reduce((values, change) => {
        if (change.feature === 'sales') values.sales = product.sales * (1 + change.value / 100);
        if (change.feature === 'inventory') values.inventory = change.type === 'absolute' ? change.value : product.inventory * (1 + change.value / 100);
        if (change.feature === 'price') values.price = change.type === 'absolute' ? change.value : product.price * (1 + change.value / 100);
        if (change.feature === 'lead_time') values.lead_time = change.type === 'absolute' ? change.value : product.lead_time * (1 + change.value / 100);
        return values;
      }, { sales: product.sales, inventory: product.inventory, price: product.price, lead_time: product.lead_time });
      const scenarioProduct = { ...product, ...scenarioChanges };
      const scenarioForecast = {
        predicted_demand: sc.predicted_demand,
        prediction_interval: sc.prediction_interval,
        model_metrics: result.model_metrics,
      };
      const risk = calculateRisk(scenarioProduct, scenarioForecast);
      return {
        ...sc,
        inventory: scenarioProduct.inventory,
        price: scenarioProduct.price,
        lead_time: scenarioProduct.lead_time,
        risk_level: risk.risk_level,
        risk_score: risk.risk_score,
        stockout_probability: risk.stockout_probability,
        overstock_probability: risk.overstock_probability,
        demand_volatility_cv: risk.demand_volatility_cv,
        forecast_uncertainty: risk.forecast_uncertainty,
        recommended_order_qty: risk.recommended_order_qty,
        inventory_coverage_days: risk.inventory_coverage_days,
        safety_stock: risk.safety_stock,
        reorder_point: risk.reorder_point,
        recommended_action: risk.recommended_action,
        expected_revenue: risk.expected_value,
        expected_profit: risk.expected_profit,
      };
    });

    res.json({
      product,
      baseline: { ...result.baseline, ...baselineRisk, inventory: product.inventory, price: product.price, lead_time: product.lead_time },
      model_metrics: result.model_metrics,
      model: result.model || getActiveModel(req.user.id),
      dataset_id: datasetId,
      methodology: result.methodology || 'Baseline ML forecast plus business-rule sensitivity adjustments.',
      scenarios: enrichedScenarios,
    });
  } catch (err) {
    res.status(422).json({ error: `Baseline forecast generation failed for ${req.body.product_id || 'the selected product'}.`, detail: err.message });
  }
});

router.get('/scenarios', authorize('ADMIN', 'MANAGER'), (req, res) => {
  res.json({ scenarios: db.listScenarios(req.user.id) });
});

router.post('/scenarios', authorize('ADMIN', 'MANAGER'), (req, res) => {
  const { name, productId, input, result } = req.body;
  if (!name || !productId || !input || !result) return res.status(400).json({ error: 'name, productId, input, and result are required.' });
  res.status(201).json({ scenario: db.insertScenario({ userId: req.user.id, name, productId, input, result }) });
});

router.delete('/scenarios/:id', authorize('ADMIN', 'MANAGER'), (req, res) => {
  if (!db.deleteScenario(req.params.id, req.user.id)) return res.status(404).json({ error: 'Scenario not found.' });
  res.status(204).end();
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/intelligence/models
// ════════════════════════════════════════════════════════════════════════════
router.get('/models', authorize('ADMIN'), async (req, res) => {
  try {
    const csv_path = req.query.csv_path || undefined;
    const activeModel = getActiveModel(req.user.id);
    const result = await runPythonForUser({ mode: 'compare', ...(csv_path ? { csv_path } : {}) }, req.user.id, 45000, req.query.datasetId);
    res.json({ ...result, models: result.models.map(model => ({ ...model, status: model.model === activeModel ? 'active' : model.status === 'unavailable' ? 'unavailable' : 'available' })), active_model: activeModel, active_dataset_id: req.query.datasetId || getActiveDatasetId(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: 'Model comparison failed.', detail: err.message });
  }
});

router.post('/models/active', authorize('ADMIN', 'MANAGER'), (req, res) => {
  const allowed = ['Random Forest', 'Linear Regression', 'Ridge Regression', 'Decision Tree'];
  if (!allowed.includes(req.body.model)) return res.status(400).json({ error: 'Unsupported active model.' });
  const preferences = db.updateUserPreferences(req.user.id, { activeModel: req.body.model, ...(req.body.datasetId ? { activeDatasetId: req.body.datasetId } : {}) });
  res.json({ active_model: preferences.activeModel, active_dataset_id: preferences.activeDatasetId || getActiveDatasetId(req.user.id) });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/intelligence/explain
// ════════════════════════════════════════════════════════════════════════════
router.post('/explain', async (req, res) => {
  try {
    const { product_id, ...overrides } = req.body;
    const products = getProductCatalogue(getUserDatasetRows(req.user.id));
    const base = products.find(p => p.id === product_id) || {};
    const input = { mode: 'explain', ...base, ...overrides };

    const result = await runPythonForUser(input, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Explanation failed.', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/intelligence/quality
// ════════════════════════════════════════════════════════════════════════════
router.post('/quality', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { csv_path } = req.body;
    const target = csv_path && fs.existsSync(csv_path) ? csv_path : DATA_CSV;
    const result = await runPython({ mode: 'quality', csv_path: target });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Quality analysis failed.', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/intelligence/audit
// ════════════════════════════════════════════════════════════════════════════
router.get('/audit', authorize('ADMIN', 'MANAGER'), (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = parseInt(req.query.offset) || 0;
    const entries = loadAudit();
    res.json({
      entries: entries.slice(offset, offset + limit),
      total: entries.length,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load audit log.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/intelligence/audit  — append entry
// ════════════════════════════════════════════════════════════════════════════
router.post('/audit', authorize('ADMIN', 'MANAGER'), (req, res) => {
  try {
    const { product_id, product_name, action, recommendation, model, confidence, reason, status } = req.body;
    if (!product_id || !action) return res.status(400).json({ error: 'product_id and action are required.' });
    const entry = appendAudit({
      product_id, product_name, action, recommendation,
      model: model || 'Random Forest',
      confidence: confidence || null,
      reason: reason || '',
      status: status || 'pending',
      user_id: req.user?.id || 'anonymous',
      user_name: req.user ? `${req.user.first_name} ${req.user.last_name || ''}`.trim() : 'System',
    });
    res.status(201).json({ entry });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record audit entry.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/intelligence/action  — approve / reject / snooze
// ════════════════════════════════════════════════════════════════════════════
router.post('/action', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { product_id, product_name, recommendation, action, decision, reason } = req.body;
    if (!product_id || !decision) return res.status(400).json({ error: 'product_id and decision are required.' });
    if (!['approved', 'rejected', 'snoozed'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved', 'rejected', or 'snoozed'." });
    }
    if (decision === 'rejected' && !String(reason || '').trim()) {
      return res.status(400).json({ error: 'A rejection reason is required.' });
    }
    const actionId = `${product_id}:${action || recommendation || 'REVIEW'}`;
    const persistedAction = db.upsertAction({
      actionId,
      productId: product_id,
      status: decision.toUpperCase(),
      recommendation: recommendation || action || 'REVIEW',
      userId: req.user.id,
      reason,
    });
    let purchaseRequest = null;
    if (decision === 'approved') {
      const products = await getCachedEnrichedProducts(req.user.id);
      const item = products.find(entry => entry.product.id === product_id);
      if (item) {
        purchaseRequest = db.insertPurchaseRequest({
          actionId,
          ownerUserId: req.user.id,
          productId: product_id,
          product: item.product.name,
          unitPrice: item.product.cost_per_unit || item.product.price,
          category: item.product.category,
          quantity: item.recommended_order_qty,
          currentInventory: item.product.inventory,
          predictedDemand: item.predicted_demand,
          stockoutRisk: item.stockout_probability,
          recommendedOrderQuantity: item.recommended_order_qty,
          priority: item.risk_level,
          requestedBy: 'AI Recommendation',
          approvedBy: req.user.id,
          approvalDate: new Date().toISOString(),
        });
      }
    }
    const entry = appendAudit({
      product_id, product_name,
      action: action || 'REVIEW',
      recommendation: recommendation || '',
      model: getActiveModel(req.user.id),
      confidence: null,
      reason: reason || '',
      status: decision,
      user_id: req.user?.id || 'anonymous',
      user_name: req.user ? `${req.user.first_name} ${req.user.last_name || ''}`.trim() : 'System',
      decision_type: 'human_review',
      action_id: actionId,
    });
    res.json({ success: true, action: persistedAction, purchaseRequest, entry });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record action.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/intelligence/copilot  — AI assistant
// ════════════════════════════════════════════════════════════════════════════
router.post('/copilot', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required.' });
  }

  const q = query.toLowerCase().trim();

  try {
    // Load fresh product data with risk scores
    const products = getProductCatalogue(getUserDatasetRows(req.user.id));
    const forecasts = await Promise.all(
      products.map(p => runPythonForUser({ mode: 'forecast', ...p }, req.user.id).catch(() => ({ predicted_demand: 0 })))
    );
    const enriched = products.map((p, i) =>
      forecasts[i].predicted_demand ? { ...p, ...calculateRisk(p, forecasts[i]) } : { ...p, risk_level: 'unknown' }
    );

    // Intent routing
    let answer = null;
    let cards = [];
    let links = [];

    const mentionedProducts = enriched.filter(p => {
      const terms = `${p.name} ${p.id}`.toLowerCase().split(/\s+/);
      return terms.some(term => term.length > 3 && q.includes(term));
    });

    // Product comparisons use the same enriched forecast/risk records as the dashboard.
    if (/compare|versus|vs\.?/.test(q) && mentionedProducts.length >= 2) {
      answer = `Here is the live comparison for ${mentionedProducts[0].name} and ${mentionedProducts[1].name}:`;
      cards = mentionedProducts.slice(0, 2).map(p => ({
        product: p.name,
        predicted_demand: Math.round(p.predicted_demand),
        inventory: p.inventory,
        stockout_probability: p.stockout_probability,
        overstock_probability: p.overstock_probability,
        risk_score: p.risk_score,
        recommended_action: p.recommended_action,
      }));
      links = mentionedProducts.slice(0, 2).map(p => ({ label: `Open ${p.name}`, page: 'action-center', product_id: p.id }));
    }

    else if (/inventory|forecast|demand|risk/.test(q) && /product[a-z]*\d|sku[a-z]*\d/.test(q) && mentionedProducts.length === 0) {
      answer = "I don't have enough data to answer that.";
    }

    // ── Stockout risk ──
    else if (/stockout|stock.?out|run.?out|out.?of.?stock/.test(q)) {
      const risky = enriched
        .filter(p => p.stockout_probability > 30)
        .sort((a, b) => b.stockout_probability - a.stockout_probability);
      if (risky.length === 0) {
        answer = 'No products are currently at significant stockout risk. All inventory levels look healthy.';
      } else {
        answer = `I found ${risky.length} product${risky.length > 1 ? 's' : ''} with elevated stockout risk:`;
        cards = risky.map(p => ({
          product: p.name, category: p.category,
          risk: `${p.stockout_probability}%`,
          coverage: `${p.inventory_coverage_days} days`,
          action: p.recommended_action,
          risk_level: p.risk_level,
        }));
        links = risky.map(p => ({ label: `View ${p.name}`, page: 'action-center' }));
      }
    }

    // ── Highest demand ──
    else if (/highest.?demand|most.?demand|top.?demand|most.?popular/.test(q)) {
      const sorted = [...enriched].sort((a, b) => b.predicted_demand - a.predicted_demand);
      answer = `The product with highest forecasted demand is **${sorted[0].name}** with ${Math.round(sorted[0].predicted_demand).toLocaleString()} units. Here is the full demand ranking:`;
      cards = sorted.map((p, i) => ({
        rank: i + 1, product: p.name, category: p.category,
        predicted: Math.round(p.predicted_demand || 0).toLocaleString() + ' units',
        risk_level: p.risk_level,
      }));
    }

    // ── What to reorder ──
    else if (/reorder|order|purchase|buy/.test(q)) {
      const toOrder = enriched
        .filter(p => ['REORDER_NOW', 'REORDER_SOON'].includes(p.recommended_action))
        .sort((a, b) => b.risk_score - a.risk_score);
      if (toOrder.length === 0) {
        answer = 'No products currently require reordering. All inventory levels are sufficient relative to forecasted demand.';
      } else {
        answer = `${toOrder.length} product${toOrder.length > 1 ? 's' : ''} need${toOrder.length === 1 ? 's' : ''} to be reordered:`;
        cards = toOrder.map(p => ({
          product: p.name, category: p.category,
          recommended_qty: p.recommended_order_qty?.toLocaleString() + ' units',
          urgency: p.recommended_action === 'REORDER_NOW' ? 'Urgent' : 'Soon',
          risk_level: p.risk_level,
        }));
        links = [{ label: 'Go to Action Center', page: 'action-center' }];
      }
    }

    // ── Overstock ──
    else if (/overstock|excess|surplus|too.?much/.test(q)) {
      const over = enriched
        .filter(p => p.overstock_probability > 40)
        .sort((a, b) => b.overstock_probability - a.overstock_probability);
      if (over.length === 0) {
        answer = 'No products appear to be significantly overstocked based on current forecasts.';
      } else {
        answer = `${over.length} product${over.length > 1 ? 's are' : ' is'} potentially overstocked:`;
        cards = over.map(p => ({
          product: p.name, category: p.category,
          overstock_prob: `${p.overstock_probability}%`,
          excess_value: `₹${(p.excess_inventory_value || 0).toLocaleString()}`,
          action: p.recommended_action,
        }));
      }
    }

    // ── Revenue at risk ──
    else if (/revenue.?at.?risk|financial.?risk|money|revenue/.test(q)) {
      const sorted = [...enriched].sort((a, b) => b.revenue_at_risk - a.revenue_at_risk);
      const totalRisk = sorted.reduce((s, p) => s + (p.revenue_at_risk || 0), 0);
      answer = `Total revenue at risk across all products: ₹${totalRisk.toLocaleString()}. Breakdown by product:`;
      cards = sorted.map(p => ({
        product: p.name, category: p.category,
        revenue_at_risk: `₹${(p.revenue_at_risk || 0).toLocaleString()}`,
        risk_level: p.risk_level,
      }));
    }

    // ── Specific product query ──
    else if (/laptop|headphones|watch|mouse/.test(q) && !/what.?if|scenario|simulation|increase|decrease/.test(q)) {
      const name = /laptop/.test(q) ? 'Laptop Pro X1' :
        /headphone/.test(q) ? 'Wireless Headphones' :
          /watch/.test(q) ? 'Smart Watch S3' : 'Gaming Mouse';
      const p = enriched.find(x => x.name === name);
      if (!p) {
        answer = `I don't have data for that product.`;
      } else {
        answer = `Here is the analysis for **${p.name}**:`;
        cards = [{
          product: p.name, category: p.category,
          predicted_demand: Math.round(p.predicted_demand || 0).toLocaleString() + ' units',
          inventory: p.inventory?.toLocaleString() + ' units',
          stockout_risk: `${p.stockout_probability}%`,
          coverage: `${p.inventory_coverage_days} days`,
          risk_level: p.risk_level,
          recommended_action: p.recommended_action,
          revenue_at_risk: `₹${(p.revenue_at_risk || 0).toLocaleString()}`,
        }];
        links = [{ label: `Full ${p.name} analysis`, page: 'action-center' }];
      }
    }

    // ── High risk products ──
    else if (/high.?risk|critical|attention|problem/.test(q)) {
      // Check if a specific product is mentioned first
      const specificName = /laptop/.test(q) ? 'Laptop Pro X1' :
        /headphone/.test(q) ? 'Wireless Headphones' :
          /watch/.test(q) ? 'Smart Watch S3' :
            /mouse/.test(q) ? 'Gaming Mouse' : null;
      if (specificName) {
        const p = enriched.find(x => x.name === specificName);
        if (p) {
          answer = `Here is why **${p.name}** has a ${p.risk_level} risk classification:`;
          cards = [{
            product: p.name,
            category: p.category,
            risk_score: `${p.risk_score}/100`,
            risk_level: p.risk_level,
            stockout_prob: `${p.stockout_probability}%`,
            coverage_days: `${p.inventory_coverage_days} days`,
            recommended_action: p.recommended_action,
            reason: p.action_reason,
          }];
          links = [{ label: `Full ${p.name} analysis`, page: 'action-center' }];
        } else {
          answer = `I don't have risk data for that product.`;
        }
      } else {
        const risky = enriched
          .filter(p => ['critical', 'high'].includes(p.risk_level))
          .sort((a, b) => b.risk_score - a.risk_score);
        if (risky.length === 0) {
          answer = 'No products are currently at high or critical risk. The inventory position looks healthy overall.';
        } else {
          answer = `${risky.length} product${risky.length > 1 ? 's need' : ' needs'} immediate attention:`;
          cards = risky.map(p => ({
            product: p.name, category: p.category,
            risk_score: p.risk_score,
            risk_level: p.risk_level,
            action: p.recommended_action,
            reason: p.action_reason,
          }));
          links = [{ label: 'Go to Action Center', page: 'action-center' }];
        }
      }
    }

    // ── Forecast uncertainty ──
    else if (/uncertain|confidence|interval|accuracy/.test(q)) {
      const sorted = [...enriched].sort((a, b) => (a.forecast_confidence || 0) - (b.forecast_confidence || 0));
      answer = `Forecast confidence varies by product. Lower confidence means higher uncertainty. Here is the breakdown:`;
      cards = sorted.map(p => ({
        product: p.name,
        confidence: `${p.forecast_confidence || 0}%`,
        interval_spread: p.prediction_interval
          ? `${Math.round(p.prediction_interval.upper - p.prediction_interval.lower)} units`
          : 'N/A',
        risk_level: p.risk_level,
      }));
      links = [{ label: 'View Model Lab', page: 'model-lab' }];
    }

    // ── Scenario / what if ──
    else if (/what.?if|scenario|simulation|increase|decrease/.test(q)) {
      const percentMatch = q.match(/(\d+(?:\.\d+)?)\s*%/);
      const target = mentionedProducts[0];
      if (target && percentMatch) {
        const pct = Number(percentMatch[1]) * (/decrease|reduce|drop/.test(q) ? -1 : 1);
        const simulation = await runPythonForUser({ mode: 'scenario', ...target, scenarios: [{ id: 'copilot-scenario', name: `Demand ${pct >= 0 ? '+' : ''}${pct}%`, sales_change_pct: pct }] }, req.user.id);
        const scenario = simulation.scenarios[0];
        answer = `For ${target.name}, a ${pct >= 0 ? '+' : ''}${pct}% demand change produces a live forecast of ${Math.round(scenario.predicted_demand)} units (baseline ${Math.round(simulation.baseline.predicted_demand)}).`;
        cards = [{ product: target.name, baseline_demand: Math.round(simulation.baseline.predicted_demand), scenario_demand: Math.round(scenario.predicted_demand), demand_delta: scenario.demand_delta, stockout_probability: scenario.stockout_probability }];
        links = [{ label: 'Open Scenario Lab', page: 'scenario-lab' }];
      } else {
        answer = 'You can test hypothetical scenarios using the Scenario Lab. I need a known product and a percentage change to calculate a result here.';
        links = [{ label: 'Open Scenario Lab', page: 'scenario-lab' }];
      }
    }

    // ── General summary ──
    else if (/summary|overview|status|today|now/.test(q)) {
      const critical = enriched.filter(p => p.risk_level === 'critical').length;
      const high = enriched.filter(p => p.risk_level === 'high').length;
      const totalRisk = enriched.reduce((s, p) => s + (p.revenue_at_risk || 0), 0);
      answer = `Here is today's inventory intelligence summary:\n\n• **${critical} critical** and **${high} high-risk** SKUs detected\n• Total revenue at risk: **₹${totalRisk.toLocaleString()}**\n• ${enriched.length} products being monitored\n\nRecommend checking the Action Center for pending decisions.`;
      links = [{ label: 'Go to Action Center', page: 'action-center' }, { label: 'View Dashboard', page: 'dashboard' }];
    }

    // ── Unknown ──
    else {
      answer = `I can help with questions about stockout risk, demand forecasts, reorder recommendations, overstock analysis, revenue at risk, and product-level analysis. Try asking:\n\n• "Which products are at risk of stockout?"\n• "What should I reorder?"\n• "Show me revenue at risk"\n• "What is the status of Smart Watch S3?"`;
    }

    res.json({ answer, cards, links, query });

  } catch (err) {
    console.error('[copilot]', err.message);
    res.status(500).json({ error: 'Copilot analysis failed.', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/intelligence/reports
// ════════════════════════════════════════════════════════════════════════════
router.get('/reports', (req, res) => {
  const auditEntries = loadAudit();
  const scenarios = db.listScenarios(req.user.id);
  const now = new Date().toISOString();
  res.json({
    reports: [
      { id: 'report-risk-current', name: 'Current Inventory Risk Report', type: 'LIVE', date: now, detail: `${getProductCatalogue(getUserDatasetRows(req.user.id)).length} products analysed` },
      { id: 'report-audit-current', name: 'AI Decision Audit Report', type: 'LIVE', date: now, detail: `${auditEntries.length} audit records` },
      { id: 'report-scenario-current', name: 'Saved Scenario Report', type: 'LIVE', date: now, detail: `${scenarios.length} saved scenarios` },
    ]
  });
});

router.get('/reports/:id', async (req, res) => {
  try {
    const reportId = req.params.id;
    const auditEntries = loadAudit();
    const scenarios = db.listScenarios(req.user.id);
    let report;

    if (reportId === 'report-risk-current') {
      const products = getProductCatalogue(getUserDatasetRows(req.user.id));
      const forecasts = await Promise.all(products.map(product => runPythonForUser({ mode: 'forecast', ...product }, req.user.id)));
      const analysed = products.map((product, index) => ({ ...product, risk: calculateRisk(product, forecasts[index]) }));
      report = {
        name: 'Current Inventory Risk Report',
        type: 'LIVE',
        data: { products: analysed, summary: { products: analysed.length, highRisk: analysed.filter(item => ['high', 'critical'].includes(item.risk.risk_level)).length } },
      };
    } else if (reportId === 'report-audit-current') {
      report = { name: 'AI Decision Audit Report', type: 'LIVE', data: { entries: auditEntries, summary: { decisions: auditEntries.length } } };
    } else if (reportId === 'report-scenario-current') {
      report = { name: 'Saved Scenario Report', type: 'LIVE', data: { scenarios, summary: { scenarios: scenarios.length } } };
    } else {
      return res.status(404).json({ error: 'Report not found.' });
    }

    res.json({ report: { id: reportId, ...report, generatedAt: new Date().toISOString(), dataset: 'Current active dataset' } });
  } catch (err) {
    console.error(`[report:${req.params.id}]`, err.message);
    res.status(500).json({ error: 'Unable to generate report.', detail: err.message });
  }
});

router.get('/analytics', (req, res) => {
  const sourceRows = getUserDatasetRows(req.user.id, req.query.datasetId);
  const product = String(req.query.product || '').trim();
  const region = String(req.query.region || '').trim();
  const granularity = req.query.granularity === 'weekly' ? 'weekly' : 'monthly';
  const dateColumn = sourceRows.some(row => row.date != null) ? 'date' : sourceRows.some(row => row.timestamp != null) ? 'timestamp' : null;
  const hasRegion = sourceRows.some(row => Object.prototype.hasOwnProperty.call(row, 'region'));
  const parseRowDate = row => {
    const candidate = dateColumn ? row[dateColumn] : (row.year && row.month ? `${row.year}-${String(row.month).padStart(2, '0')}-01` : null);
    if (!candidate) return null;
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const validDates = sourceRows.map(parseRowDate).filter(Boolean);
  const availableStart = validDates.length ? new Date(Math.min(...validDates.map(date => date.getTime()))).toISOString().slice(0, 10) : null;
  const availableEnd = validDates.length ? new Date(Math.max(...validDates.map(date => date.getTime()))).toISOString().slice(0, 10) : null;
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59Z`) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) {
    return res.status(400).json({ error: 'Invalid date range.' });
  }
  if ((from && availableStart && req.query.from < availableStart) || (to && availableEnd && req.query.to > availableEnd)) {
    return res.status(400).json({ error: 'Selected date range is outside the available dataset period.', availableStart, availableEnd });
  }
  if (region && !hasRegion && region.toLowerCase() !== 'all regions') {
    return res.status(400).json({ error: 'This dataset does not contain a region column.' });
  }

  const filtered = sourceRows.map(row => ({ row, date: parseRowDate(row) })).filter(({ row, date }) => {
    const productMatch = !product || product.toLowerCase() === 'all products' || String(row.product || '').toLowerCase() === product.toLowerCase();
    const regionMatch = !region || region.toLowerCase() === 'all regions' || String(row.region || '').toLowerCase() === region.toLowerCase();
    return productMatch && regionMatch && date && (!from || date >= from) && (!to || date <= to);
  });
  const grouped = new Map();
  filtered.forEach(({ row, date }) => {
    const periodDate = new Date(date);
    if (granularity === 'weekly') {
      const day = periodDate.getUTCDay() || 7;
      periodDate.setUTCDate(periodDate.getUTCDate() - day + 1);
    } else {
      periodDate.setUTCDate(1);
    }
    const period = periodDate.toISOString().slice(0, 10);
    const key = `${row.product || 'Unknown'}|${period}`;
    const current = grouped.get(key) || { product: row.product || 'Unknown', category: row.category || 'Unknown', period, date: period, month: periodDate.getUTCMonth() + 1, sales: 0, demand: 0, rows: 0 };
    current.sales += Number(row.sales) || 0;
    current.demand += Number(row.demand) || 0;
    current.rows += 1;
    grouped.set(key, current);
  });
  const rows = [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));
  res.json({ rows, products: [...new Set(sourceRows.map(row => row.product).filter(Boolean))].sort(), regions: hasRegion ? [...new Set(sourceRows.map(row => row.region).filter(Boolean))].sort() : [], hasRegion, availableStart, availableEnd, filters: { product, from: req.query.from || availableStart, to: req.query.to || availableEnd, region, granularity }, dataAvailable: rows.length > 0 });
});

router.get('/ml-dataset', authorize('ADMIN', 'MANAGER'), (req, res) => {
  const product = String(req.query.product || '').trim().toLowerCase();
  const rows = getUserDatasetRows(req.user.id).filter(row => !product || row.product.toLowerCase().includes(product));
  res.json({ rows: rows.map(row => ({ x: row.month, y: row.demand, product: row.product })) });
});

router.get('/ml-schema', authorize('ADMIN', 'MANAGER'), (req, res) => {
  const dataset = req.query.datasetId ? db.findDataset(req.query.datasetId, req.user.id) : null;
  if (req.query.datasetId && !dataset) return res.status(404).json({ error: 'Dataset not found.' });
  const rows = dataset ? dataset.rows : loadDatasetRows();
  const headers = dataset ? dataset.headers : (rows[0] ? Object.keys(rows[0]) : []);
  res.json({ datasetId: dataset?.id || null, name: dataset?.name || 'Default dataset', headers, rows: rows.slice(0, 3) });
});

router.get('/datasets', authorize('ADMIN', 'MANAGER'), (req, res) => {
  res.json({
    datasets: db.listDatasets(req.user.id).map(dataset => ({
      id: dataset.id, name: dataset.name, headers: dataset.headers,
      rowCount: dataset.rowCount, columnCount: dataset.columnCount,
      createdAt: dataset.createdAt,
    }))
  });
});

router.get('/datasets/:id', authorize('ADMIN', 'MANAGER'), (req, res) => {
  const dataset = db.findDataset(req.params.id, req.user.id);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found.' });
  res.json({ dataset });
});

router.post('/datasets', authorize('ADMIN', 'MANAGER'), (req, res) => {
  const { name, headers, rows } = req.body;
  if (!name || !Array.isArray(headers) || !headers.length || !Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'name, headers, and rows are required.' });
  }
  if (rows.length > 100000) return res.status(413).json({ error: 'Dataset exceeds the 100,000 row limit.' });
  const dataset = db.insertDataset({ userId: req.user.id, name, headers, rows });
  res.status(201).json({ dataset: { id: dataset.id, name: dataset.name, headers: dataset.headers, rowCount: dataset.rowCount, columnCount: dataset.columnCount, createdAt: dataset.createdAt } });
});

router.delete('/datasets/:id', authorize('ADMIN', 'MANAGER'), (req, res) => {
  if (!db.deleteDataset(req.params.id, req.user.id)) return res.status(404).json({ error: 'Dataset not found.' });
  res.status(204).end();
});

router.post('/ml-train', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { datasetId, target, features, testFraction } = req.body;
  let csvPath = DATA_CSV;
  let temporaryPath = null;
  try {
    if (datasetId) {
      const dataset = db.findDataset(datasetId, req.user.id);
      if (!dataset) return res.status(404).json({ error: 'Dataset not found.' });
      temporaryPath = path.join(__dirname, `../_ml_${Date.now()}.csv`);
      fs.writeFileSync(temporaryPath, [dataset.headers.join(','), ...dataset.rows.map(row => dataset.headers.map(header => row[header] ?? '').join(','))].join('\n'), 'utf8');
      csvPath = temporaryPath;
    }
    const result = await runPython({ mode: 'train', csv_path: csvPath, target: target || 'demand', features: Array.isArray(features) ? features : [], test_fraction: Number(testFraction || 0.25) }, 45000);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Model training failed.' });
  } finally {
    if (temporaryPath) try { fs.unlinkSync(temporaryPath); } catch (_) { }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/intelligence/search?q=term
// ════════════════════════════════════════════════════════════════════════════
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) {
    return res.json({ results: [], query: q, total: 0 });
  }

  try {
    // ── Load products with live risk data ────────────────────────────────
    const products = getProductCatalogue(getUserDatasetRows(req.user.id));
    const forecasts = await Promise.all(
      products.map(p => runPythonForUser({ mode: 'forecast', ...p }, req.user.id).catch(() => ({ predicted_demand: 0 })))
    );
    const enriched = products.map((p, i) =>
      forecasts[i].predicted_demand
        ? { ...p, ...calculateRisk(p, forecasts[i]) }
        : { ...p, risk_level: 'unknown', stockout_probability: 0, predicted_demand: 0, recommended_action: '—' }
    );

    // ── Audit entries for scenario/report/action search ───────────────────
    const auditEntries = loadAudit();

    const results = [];

    // ── PRODUCTS ──────────────────────────────────────────────────────────
    enriched.forEach(p => {
      const searchable = `${p.name} ${p.id} ${p.category}`.toLowerCase();
      if (!searchable.includes(q)) return;
      results.push({
        type: 'product',
        id: p.id,
        title: p.name,
        subtitle: `${p.category} · SKU: ${p.id.toUpperCase()}`,
        meta: `Inventory: ${p.inventory?.toLocaleString()} units`,
        badge: p.risk_level || 'unknown',
        page: 'action-center',
        icon: 'box',
      });
    });

    // ── INVENTORY (stockout/overstock alerts per product) ─────────────────
    enriched.forEach(p => {
      const sp = p.stockout_probability || 0;
      const searchable = `${p.name} ${p.id} ${p.category} inventory stock ${sp > 50 ? 'critical' : sp > 25 ? 'low' : 'healthy'}`.toLowerCase();
      if (!searchable.includes(q)) return;
      results.push({
        type: 'inventory',
        id: `inv-${p.id}`,
        title: p.name,
        subtitle: `Inventory · ${p.category}`,
        meta: `Stock: ${p.inventory?.toLocaleString()} · Stockout Risk: ${sp}%`,
        badge: p.risk_level || 'unknown',
        page: 'alerts',
        icon: 'warehouse',
      });
    });

    // ── FORECASTS ─────────────────────────────────────────────────────────
    enriched.forEach(p => {
      const searchable = `${p.name} ${p.id} ${p.category} forecast demand prediction`.toLowerCase();
      if (!searchable.includes(q)) return;
      results.push({
        type: 'forecast',
        id: `fc-${p.id}`,
        title: p.name,
        subtitle: `Forecast · ${p.category}`,
        meta: `Predicted: ${Math.round(p.predicted_demand || 0).toLocaleString()} units · Confidence: ${p.forecast_confidence || 0}%`,
        badge: null,
        page: 'forecast',
        icon: 'chart-line',
      });
    });

    // ── ACTIONS / ALERTS ──────────────────────────────────────────────────
    enriched
      .filter(p => p.recommended_action && p.recommended_action !== 'HOLD')
      .forEach(p => {
        const actionLabel = (p.recommended_action || '').replace(/_/g, ' ');
        const searchable = `${p.name} ${p.id} ${actionLabel} action reorder alert risk`.toLowerCase();
        if (!searchable.includes(q)) return;
        results.push({
          type: 'action',
          id: `act-${p.id}`,
          title: p.name,
          subtitle: `Action Required · ${p.category}`,
          meta: actionLabel,
          badge: p.risk_level || 'unknown',
          page: 'action-center',
          icon: 'bolt',
        });
      });

    // ── SCENARIOS (from audit log) ────────────────────────────────────────
    const scenarioEntries = auditEntries.filter(e =>
      (e.action || '').toLowerCase().includes('scenario') ||
      (e.recommendation || '').toLowerCase().includes('scenario')
    );
    scenarioEntries.forEach(e => {
      const searchable = `${e.product_name || ''} ${e.action || ''} ${e.recommendation || ''} scenario`.toLowerCase();
      if (!searchable.includes(q)) return;
      results.push({
        type: 'scenario',
        id: e.id,
        title: e.product_name || e.product_id || 'Scenario',
        subtitle: 'Scenario · ' + (new Date(e.timestamp).toLocaleDateString()),
        meta: e.recommendation || e.action,
        badge: null,
        page: 'scenario-lab',
        icon: 'flask',
      });
    });

    // ── REPORTS (derived from current application data) ───────────────────
    const reportsCatalogue = [
      { id: 'report-risk-current', name: 'Current Inventory Risk Report', type: 'LIVE', date: new Date().toISOString(), detail: `${enriched.length} products analysed` },
      { id: 'report-audit-current', name: 'AI Decision Audit Report', type: 'LIVE', date: new Date().toISOString(), detail: `${auditEntries.length} audit records` },
      { id: 'report-scenario-current', name: 'Saved Scenario Report', type: 'LIVE', date: new Date().toISOString(), detail: 'Scenario comparisons from the database' },
    ];
    reportsCatalogue.forEach(r => {
      const searchable = `${r.name} ${r.type} ${r.detail} report forecast analysis risk scenario`.toLowerCase();
      if (!searchable.includes(q)) return;
      results.push({
        type: 'report',
        id: r.id,
        title: r.name,
        subtitle: `Report · ${r.type} · ${r.date}`,
        meta: r.detail,
        badge: null,
        page: 'reports',
        icon: 'file-chart-column',
      });
    });

    // ── PAGES (navigation) ────────────────────────────────────────────────
    const pages = [
      { id: 'dashboard', name: 'Dashboard', desc: 'Command Center · KPIs and action items', icon: 'gauge-high' },
      { id: 'forecast', name: 'Demand Intelligence', desc: 'AI demand forecasting with explainability', icon: 'chart-line' },
      { id: 'alerts', name: 'Inventory Intelligence', desc: 'Stockout and overstock analysis', icon: 'boxes-stacked' },
      { id: 'scenario-lab', name: 'Scenario Lab', desc: 'What-if scenario simulation engine', icon: 'flask' },
      { id: 'copilot', name: 'ForecastIQ Copilot', desc: 'AI assistant for inventory questions', icon: 'robot' },
      { id: 'action-center', name: 'Action Center', desc: 'Review and approve AI recommendations', icon: 'bolt' },
      { id: 'model-lab', name: 'Model Lab', desc: 'ML model comparison and metrics', icon: 'microchip' },
      { id: 'upload', name: 'Dataset Upload', desc: 'Upload CSV data for forecasting', icon: 'upload' },
      { id: 'reports', name: 'Reports', desc: 'Forecasting and analytics reports', icon: 'file-chart-column' },
      { id: 'audit', name: 'Audit Log', desc: 'History of AI decisions and approvals', icon: 'clock-rotate-left' },
      { id: 'data-quality', name: 'Data Quality', desc: 'Dataset quality analysis and scoring', icon: 'shield-check' },
      { id: 'settings', name: 'Settings', desc: 'System preferences and configuration', icon: 'gear' },
    ];
    pages.forEach(pg => {
      if (!`${pg.name} ${pg.id} ${pg.desc}`.toLowerCase().includes(q)) return;
      results.push({
        type: 'page',
        id: `page-${pg.id}`,
        title: pg.name,
        subtitle: 'Navigation',
        meta: pg.desc,
        badge: null,
        page: pg.id,
        icon: pg.icon,
      });
    });

    // ── Deduplicate by id, cap at 30 total ────────────────────────────────
    const seen = new Set();
    const deduped = results.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id); return true;
    }).slice(0, 30);

    // ── Group by type ─────────────────────────────────────────────────────
    const ORDER = ['product', 'inventory', 'forecast', 'action', 'scenario', 'report', 'page'];
    deduped.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));

    res.json({ results: deduped, query: q, total: deduped.length });

  } catch (err) {
    console.error('[search]', err.message);
    res.status(500).json({ error: 'Search temporarily unavailable.', results: [], total: 0 });
  }
});

module.exports = router;
