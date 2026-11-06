/**
 * test_api.js — End-to-end API tests
 * Run: node test_api.js
 */
'use strict';

const BASE = 'http://localhost:4000';
let pass = 0, fail = 0;

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const data = await r.json();
  return { status: r.status, data };
}

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
    pass++;
  } catch (e) {
    console.log(`  ✗  ${label} — ${e.message}`);
    fail++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

(async () => {
  console.log('\n══ ForecastAI API Test Suite ══\n');

  // Health
  await test('GET /api/health', async () => {
    const { data } = await req('GET', '/api/health');
    assert(data.status === 'ok', `got ${data.status}`);
    assert(data.version === '2.0.0', `version ${data.version}`);
  });

  // Forecast
  await test('POST /api/forecast — basic', async () => {
    const { data } = await req('POST', '/api/forecast', { sales: 580, inventory: 1000, price: 85000, month: 9, lead_time: 14 });
    assert(data.predicted_demand > 0, 'no prediction');
    assert(data.prediction_interval, 'no interval');
    assert(data.model_metrics?.mae > 0, 'no MAE');
    assert(Array.isArray(data.feature_contributions), 'no contributions');
  });

  await test('POST /api/forecast — missing fields', async () => {
    const { status } = await req('POST', '/api/forecast', { sales: 100 });
    assert(status === 400, `expected 400 got ${status}`);
  });

  // Models
  await test('GET /api/models — returns 4 models', async () => {
    const { data } = await req('GET', '/api/models');
    assert(Array.isArray(data.models), 'no models array');
    assert(data.models.length === 4, `expected 4 got ${data.models.length}`);
    assert(data.best_model, 'no best_model');
    const rf = data.models.find(m => m.model === 'Random Forest');
    assert(rf?.mape > 0, 'RF MAPE missing');
    assert(rf?.mae > 0, 'RF MAE missing');
    assert(rf?.rmse > 0, 'RF RMSE missing');
    assert(data.split_info?.method === 'chronological', 'wrong split method');
  });

  // Scenario
  await test('POST /api/scenario — two scenarios', async () => {
    const { data } = await req('POST', '/api/scenario', {
      sales: 580, inventory: 1000, price: 85000, month: 9, lead_time: 14,
      scenarios: [
        { id: 'sc1', name: 'Demand +20%', sales_change_pct: 20 },
        { id: 'sc2', name: 'Lead +10d', lead_time_value: 24 },
      ]
    });
    assert(data.baseline?.predicted_demand > 0, 'no baseline');
    assert(data.scenarios?.length === 2, 'wrong scenario count');
    assert(data.scenarios[0].demand_delta_pct !== undefined, 'no delta pct');
  });

  // Intelligence — dashboard
  await test('GET /api/intelligence/dashboard', async () => {
    const { data } = await req('GET', '/api/intelligence/dashboard');
    assert(data.kpis, 'no kpis');
    assert(data.kpis.predicted_demand > 0, 'no predicted demand');
    assert(Array.isArray(data.products), 'no products');
    assert(data.products.length === 4, `expected 4 products got ${data.products.length}`);
    assert(Array.isArray(data.action_items), 'no action_items');
  });

  // Intelligence — products
  await test('GET /api/intelligence/products', async () => {
    const { data } = await req('GET', '/api/intelligence/products');
    assert(Array.isArray(data.products), 'no products');
    const p = data.products[0];
    assert(p.risk_level, 'no risk_level');
    assert(p.risk_score !== undefined, 'no risk_score');
    assert(p.stockout_probability !== undefined, 'no stockout_prob');
    assert(p.recommended_action, 'no action');
  });

  // Intelligence — product detail
  await test('GET /api/intelligence/product/smart-watch-s3', async () => {
    const { data } = await req('GET', '/api/intelligence/product/smart-watch-s3');
    assert(data.product?.id === 'smart-watch-s3', 'wrong product');
    assert(data.risk?.risk_score !== undefined, 'no risk score');
    assert(data.risk?.safety_stock !== undefined, 'no safety stock');
    assert(data.explanation?.feature_contributions?.length > 0, 'no contributions');
  });

  await test('GET /api/intelligence/product/nonexistent — 404', async () => {
    const { status } = await req('GET', '/api/intelligence/product/nonexistent');
    assert(status === 404, `expected 404 got ${status}`);
  });

  // Intelligence — scenario
  await test('POST /api/intelligence/scenario', async () => {
    const { data } = await req('POST', '/api/intelligence/scenario', {
      product_id: 'laptop-pro-x1',
      scenarios: [{ id: 's1', name: 'Price Cut -15%', price_change_pct: -15 }]
    });
    assert(data.product?.name === 'Laptop Pro X1', 'wrong product');
    assert(data.baseline?.predicted_demand > 0, 'no baseline');
    assert(data.scenarios?.length === 1, 'wrong scenario count');
    assert(data.scenarios[0].risk_level, 'no risk_level in scenario');
  });

  // Intelligence — models
  await test('GET /api/intelligence/models', async () => {
    const { data } = await req('GET', '/api/intelligence/models');
    assert(data.models?.length === 4, 'expected 4 models');
    assert(data.best_model, 'no best_model');
  });

  // Intelligence — explain
  await test('POST /api/intelligence/explain', async () => {
    const { data } = await req('POST', '/api/intelligence/explain', {
      product_id: 'gaming-mouse', sales: 650, inventory: 800, price: 2600, month: 10, lead_time: 5
    });
    assert(data.predicted_demand > 0, 'no prediction');
    assert(data.feature_contributions?.length > 0, 'no contributions');
    assert(data.model_metrics?.mape > 0, 'no MAPE');
  });

  // Intelligence — quality
  await test('POST /api/intelligence/quality — default CSV', async () => {
    const { data } = await req('POST', '/api/intelligence/quality', {});
    assert(typeof data.score === 'number', 'no score');
    assert(data.rows === 48, `expected 48 rows got ${data.rows}`);
    assert(Array.isArray(data.issues), 'no issues array');
  });

  // Copilot
  await test('POST /api/intelligence/copilot — stockout query', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', { query: 'Which products are at risk of stockout?' });
    assert(data.answer, 'no answer');
    assert(Array.isArray(data.cards), 'no cards');
  });

  await test('POST /api/intelligence/copilot — reorder query', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', { query: 'What should I reorder?' });
    assert(data.answer, 'no answer');
  });

  await test('POST /api/intelligence/copilot — specific product', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', { query: 'Tell me about Smart Watch' });
    assert(data.answer, 'no answer');
    assert(data.cards?.length > 0, 'no product card');
  });

  await test('POST /api/intelligence/copilot — missing query', async () => {
    const { status } = await req('POST', '/api/intelligence/copilot', {});
    assert(status === 400, `expected 400 got ${status}`);
  });

  // Audit
  await test('POST /api/intelligence/audit — record entry', async () => {
    const { status, data } = await req('POST', '/api/intelligence/audit', {
      product_id: 'smart-watch-s3',
      product_name: 'Smart Watch S3',
      action: 'REORDER_NOW',
      recommendation: 'Order 4500 units',
      status: 'pending',
    });
    assert(status === 201, `expected 201 got ${status}`);
    assert(data.entry?.id, 'no entry id');
  });

  await test('GET /api/intelligence/audit — returns entries', async () => {
    const { data } = await req('GET', '/api/intelligence/audit');
    assert(Array.isArray(data.entries), 'no entries');
    assert(data.total > 0, 'no total');
  });

  // Action approval
  await test('POST /api/intelligence/action — approve', async () => {
    const { data } = await req('POST', '/api/intelligence/action', {
      product_id: 'smart-watch-s3',
      product_name: 'Smart Watch S3',
      recommendation: 'Reorder 4500 units',
      action: 'REORDER_NOW',
      decision: 'approved',
      reason: 'Stock critically low',
    });
    assert(data.success, 'not success');
    assert(data.entry?.status === 'approved', 'wrong status');
  });

  await test('POST /api/intelligence/action — invalid decision', async () => {
    const { status } = await req('POST', '/api/intelligence/action', {
      product_id: 'test', decision: 'maybe'
    });
    assert(status === 400, `expected 400 got ${status}`);
  });

  // Upload forecast
  await test('POST /api/upload-forecast — with rows', async () => {
    const rows = [
      { sales: 380, inventory: 900, price: 4500, month: 6, lead_time: 7, demand: 460 },
      { sales: 400, inventory: 850, price: 4500, month: 7, lead_time: 7, demand: 490 },
      { sales: 430, inventory: 800, price: 4400, month: 8, lead_time: 7, demand: 520 },
      { sales: 450, inventory: 750, price: 4400, month: 9, lead_time: 7, demand: 560 },
      { sales: 500, inventory: 700, price: 4300, month: 10, lead_time: 7, demand: 620 },
    ];
    const { data } = await req('POST', '/api/upload-forecast', { rows });
    assert(data.predicted_demand > 0, `no prediction, got: ${JSON.stringify(data).slice(0, 100)}`);
    assert(data.rows_used === 5, `expected 5 rows got ${data.rows_used}`);
  });

  // Data quality endpoint
  await test('POST /api/data-quality — default CSV', async () => {
    const { data } = await req('POST', '/api/data-quality', {});
    assert(typeof data.score === 'number', 'no score');
    assert(data.rows === 48, `expected 48 got ${data.rows}`);
  });

  // Summary
  console.log(`\n══ Results: ${pass} passed, ${fail} failed ══\n`);
  if (fail > 0) process.exit(1);
})();
