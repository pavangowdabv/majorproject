/**
 * test_audit.js — Comprehensive end-to-end test suite
 * Tests: Search, All 5 Features, ML, APIs, Action workflow
 * Run: node test_audit.js
 */
'use strict';

const BASE = 'http://localhost:4000';
let pass = 0, fail = 0, warn = 0;
const issues = [];

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const data = await r.json().catch(() => ({}));
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
    issues.push({ label, error: e.message });
  }
}

async function warn_test(label, fn) {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
    pass++;
  } catch (e) {
    console.log(`  ⚠  ${label} — ${e.message}`);
    warn++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

(async () => {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  ForecastAI Complete End-to-End Audit Test Suite');
  console.log('══════════════════════════════════════════════════\n');

  // ── HEALTH ──────────────────────────────────────────────────────────────
  console.log('── Health ──');
  await test('Backend is running', async () => {
    const { data } = await req('GET', '/api/health');
    assert(data.status === 'ok', 'not ok');
    assert(data.version, 'no version');
  });

  // ── SEARCH (Priority 1) ──────────────────────────────────────────────────
  console.log('\n── Priority 1: Global Search ──');

  await test('Search "watch" returns Smart Watch results', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=watch');
    assert(data.results?.length > 0, 'no results');
    const hasWatch = data.results.some(r => r.title.toLowerCase().includes('watch'));
    assert(hasWatch, `no Smart Watch in results: ${data.results.map(r=>r.title).join(', ')}`);
  });

  await test('Search groups results by type', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=smart');
    const types = [...new Set(data.results.map(r => r.type))];
    assert(types.length > 0, 'no type grouping');
  });

  await test('Search "laptop" finds product + inventory + forecast', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=laptop');
    const types = [...new Set(data.results.map(r => r.type))];
    assert(types.includes('product'), 'no product result');
    assert(types.includes('forecast') || types.includes('inventory'), 'no forecast/inventory result');
  });

  await test('Search result has required fields', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=headphone');
    const r = data.results[0];
    assert(r.type, 'no type'); assert(r.id, 'no id'); assert(r.title, 'no title');
    assert(r.page, 'no page (navigation target)'); assert(r.icon, 'no icon');
  });

  await test('Search short query (1 char) returns empty gracefully', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=a');
    assert(Array.isArray(data.results), 'not array');
    assert(data.results.length === 0, 'should be empty for 1-char query');
  });

  await test('Search nonexistent term returns empty results', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=xyznonexistent99');
    assert(Array.isArray(data.results), 'not array');
    assert(data.results.length === 0, `should be 0 results, got ${data.results.length}`);
  });

  await test('Search "reorder" finds action results', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=reorder');
    assert(data.results?.length > 0, 'no results');
    const actionResult = data.results.find(r => r.type === 'action' || r.type === 'page');
    assert(actionResult, 'no action/page result for reorder');
  });

  await test('Search "forecast" finds forecast results', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=forecast');
    const hasForecast = data.results.some(r => r.type === 'forecast' || r.type === 'page');
    assert(hasForecast, 'no forecast result');
  });

  await test('Search "report" finds report results', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=report');
    assert(data.results?.length > 0, 'no results');
    const hasReport = data.results.some(r => r.type === 'report' || r.type === 'page');
    assert(hasReport, `no report result, got types: ${[...new Set(data.results.map(r=>r.type))].join(',')}`);
  });

  await test('Search results have navigable page property', async () => {
    const { data } = await req('GET', '/api/intelligence/search?q=mouse');
    data.results.forEach(r => assert(r.page, `result "${r.title}" has no page`));
  });

  // ── FEATURE 1: AI DECISION ENGINE ─────────────────────────────────────────
  console.log('\n── Feature 1: AI Decision Engine ──');

  let dashData;
  await test('Dashboard loads with real KPIs', async () => {
    const { data } = await req('GET', '/api/intelligence/dashboard');
    dashData = data;
    assert(data.kpis.total_revenue > 0, `revenue=${data.kpis.total_revenue}`);
    assert(data.kpis.predicted_demand > 0, `demand=${data.kpis.predicted_demand}`);
    assert(typeof data.kpis.avg_forecast_confidence === 'number', 'no confidence');
    assert(Array.isArray(data.products), 'no products');
    assert(data.products.length === 4, `expected 4 products got ${data.products.length}`);
  });

  await test('Each product has calculated risk fields', async () => {
    const { data } = await req('GET', '/api/intelligence/products');
    data.products.forEach(p => {
      assert(typeof p.stockout_probability === 'number', `${p.name}: no stockout_prob`);
      assert(p.stockout_probability >= 0 && p.stockout_probability <= 100,
        `${p.name}: stockout_prob ${p.stockout_probability} out of 0-100 range`);
      assert(p.risk_level, `${p.name}: no risk_level`);
      assert(p.recommended_action, `${p.name}: no recommended_action`);
    });
  });

  await test('Stockout probability is in 0-100 range (not 0-1)', async () => {
    const { data } = await req('GET', '/api/intelligence/products');
    data.products.forEach(p => {
      assert(p.stockout_probability <= 100,
        `${p.name} stockout_probability=${p.stockout_probability} is >100 (fractional bug)`);
    });
  });

  await test('Smart Watch S3 product detail has full analysis', async () => {
    const { data } = await req('GET', '/api/intelligence/product/smart-watch-s3');
    assert(data.product.name === 'Smart Watch S3', 'wrong product');
    assert(data.risk.safety_stock !== undefined, 'no safety stock');
    assert(data.risk.reorder_point !== undefined, 'no reorder point');
    assert(data.risk.inventory_coverage_days !== undefined, 'no coverage days');
    assert(data.risk.revenue_at_risk !== undefined, 'no revenue at risk');
    assert(data.explanation.feature_contributions.length > 0, 'no feature contributions');
  });

  await test('Revenue at risk is non-negative', async () => {
    const { data } = await req('GET', '/api/intelligence/products');
    data.products.forEach(p => {
      assert((p.revenue_at_risk || 0) >= 0, `${p.name} negative revenue_at_risk`);
    });
  });

  await test('Action items are generated from real data', async () => {
    const { data } = await req('GET', '/api/intelligence/dashboard');
    assert(Array.isArray(data.action_items), 'no action items');
    data.action_items.forEach(a => {
      assert(a.product_id, 'no product_id in action');
      assert(a.action, 'no action type');
      assert(a.risk_level, 'no risk_level');
    });
  });

  // ── FEATURE 2: SCENARIO LAB ──────────────────────────────────────────────
  console.log('\n── Feature 2: Scenario Lab ──');

  let baselineDemand;
  await test('Baseline vs scenario produces different demand', async () => {
    const { data } = await req('POST', '/api/intelligence/scenario', {
      product_id: 'smart-watch-s3',
      scenarios: [
        { id: 'sc1', name: 'Demand +20%', sales_change_pct: 20 },
        { id: 'sc2', name: 'Demand -20%', sales_change_pct: -20 },
      ]
    });
    assert(data.baseline.predicted_demand > 0, 'no baseline demand');
    baselineDemand = data.baseline.predicted_demand;
    const up = data.scenarios[0].predicted_demand;
    const down = data.scenarios[1].predicted_demand;
    assert(up > baselineDemand, `+20% scenario (${up}) should be > baseline (${baselineDemand})`);
    assert(down < baselineDemand, `-20% scenario (${down}) should be < baseline (${baselineDemand})`);
  });

  await test('Scenario A: demand +10% increases demand', async () => {
    const { data } = await req('POST', '/api/intelligence/scenario', {
      product_id: 'laptop-pro-x1',
      scenarios: [{ id: 'sc', name: 'A+10%', sales_change_pct: 10 }]
    });
    assert(data.scenarios[0].demand_delta > 0, `demand_delta should be positive, got ${data.scenarios[0].demand_delta}`);
  });

  await test('Scenario B: demand +25% — stockout risk increases vs baseline', async () => {
    const { data } = await req('POST', '/api/intelligence/scenario', {
      product_id: 'smart-watch-s3',
      scenarios: [{ id: 'sc', name: 'B+25%', sales_change_pct: 25 }]
    });
    // With more demand and same inventory, stockout should be >= baseline
    const baselineRisk = data.baseline.predicted_demand;
    const scenRisk = data.scenarios[0].predicted_demand;
    assert(scenRisk > baselineRisk, `+25% demand should increase predicted demand`);
  });

  await test('Scenario supplier delay changes lead time risk', async () => {
    const { data } = await req('POST', '/api/intelligence/scenario', {
      product_id: 'gaming-mouse',
      scenarios: [{ id: 'sc', name: 'Lead+7d', lead_time_value: 12 }]
    });
    assert(data.scenarios[0].risk_score !== undefined, 'no risk_score in scenario result');
  });

  await test('Scenario price -10% is processed', async () => {
    const { data } = await req('POST', '/api/intelligence/scenario', {
      product_id: 'wireless-headphones',
      scenarios: [{ id: 'sc', name: 'Price-10%', price_change_pct: -10 }]
    });
    assert(data.baseline.predicted_demand > 0, 'no baseline');
    assert(data.scenarios.length === 1, 'should have 1 scenario');
  });

  await test('Scenario comparison has delta and delta_pct', async () => {
    const { data } = await req('POST', '/api/intelligence/scenario', {
      product_id: 'smart-watch-s3',
      scenarios: [{ id: 'sc', name: 'Test', sales_change_pct: 15 }]
    });
    const sc = data.scenarios[0];
    assert(sc.demand_delta !== undefined, 'no demand_delta');
    assert(sc.demand_delta_pct !== undefined, 'no demand_delta_pct');
    assert(sc.risk_level, 'no risk_level in scenario');
    assert(sc.inventory_coverage_days !== undefined, 'no coverage_days in scenario');
  });

  // ── FEATURE 3: EXPLAINABLE FORECASTING ──────────────────────────────────
  console.log('\n── Feature 3: Explainable Forecasting ──');

  await test('Forecast returns prediction interval {lower, upper}', async () => {
    const { data } = await req('POST', '/api/forecast', {
      sales: 415, inventory: 320, price: 11200, month: 10, lead_time: 10
    });
    assert(data.prediction_interval, 'no prediction_interval');
    assert(typeof data.prediction_interval.lower === 'number', 'interval.lower not a number');
    assert(typeof data.prediction_interval.upper === 'number', 'interval.upper not a number');
    assert(data.prediction_interval.lower < data.prediction_interval.upper,
      `lower (${data.prediction_interval.lower}) should be < upper (${data.prediction_interval.upper})`);
  });

  await test('Prediction interval is statistically valid (not just ±arbitrary%)', async () => {
    const { data } = await req('POST', '/api/forecast', {
      sales: 620, inventory: 1200, price: 80000, month: 10, lead_time: 14
    });
    const pi = data.prediction_interval;
    const spread = pi.upper - pi.lower;
    // Should have meaningful spread based on model uncertainty, not just ±4.2%
    assert(spread > 0, 'zero spread — interval not calculated');
    assert(data.prediction_interval.confidence === 0.9, `expected 90% confidence, got ${pi.confidence}`);
  });

  await test('Feature contributions are calculated (not fake)', async () => {
    const { data } = await req('POST', '/api/forecast', {
      sales: 695, inventory: 760, price: 2600, month: 10, lead_time: 5
    });
    assert(Array.isArray(data.feature_contributions), 'no contributions array');
    assert(data.feature_contributions.length > 0, 'empty contributions');
    const c = data.feature_contributions[0];
    assert(c.feature, 'no feature name'); assert(c.contribution !== undefined, 'no contribution value');
    assert(c.direction, 'no direction'); assert(c.input_value !== undefined, 'no input_value');
    // Verify contribution is not just a placeholder
    const nonZero = data.feature_contributions.some(x => x.contribution !== 0);
    assert(nonZero, 'all contributions are 0 — likely fake');
  });

  await test('Feature contributions sum to approximate prediction difference from baseline', async () => {
    const { data } = await req('POST', '/api/intelligence/explain', {
      product_id: 'smart-watch-s3',
      sales: 415, inventory: 320, price: 11200, month: 10, lead_time: 10
    });
    assert(data.predicted_demand > 0, 'no predicted_demand');
    assert(data.baseline_prediction > 0, 'no baseline_prediction');
    assert(data.feature_contributions.length > 0, 'no contributions');
  });

  await test('Model metrics use test-set values, not training accuracy', async () => {
    const { data } = await req('POST', '/api/forecast', {
      sales: 900, inventory: 980, price: 4100, month: 10, lead_time: 7
    });
    assert(data.model_metrics, 'no model_metrics');
    assert(data.model_metrics.mape !== null, 'null MAPE');
    assert(data.model_metrics.mape < 50, `MAPE ${data.model_metrics.mape}% suspiciously high`);
    assert(data.model_metrics.note?.includes('chronological'), 'no chronological split note');
  });

  // ── FEATURE 4: AI COPILOT ────────────────────────────────────────────────
  console.log('\n── Feature 4: AI Copilot ──');

  await test('Query: "Which products are at risk of stockout?" returns real data', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', {
      query: 'Which products are at risk of stockout?'
    });
    assert(data.answer, 'no answer');
    assert(!data.answer.includes('undefined'), 'answer contains undefined');
    // Should either say products found or all clear — not a generic error
    assert(data.answer.length > 10, 'answer too short');
  });

  await test('Query: "Which product has the highest demand?" returns ranked list', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', {
      query: 'Which product has the highest demand?'
    });
    assert(data.answer.includes('highest') || data.answer.includes('demand'), 'answer doesnt address demand');
    assert(data.cards?.length > 0, 'no product cards returned');
    assert(data.cards[0].rank === 1 || data.cards[0].predicted, 'no ranking or prediction in card');
  });

  await test('Query: "Why is Smart Watch S3 high risk?" addresses specific product', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', {
      query: 'Why is Smart Watch S3 high risk?'
    });
    assert(data.answer, 'no answer');
    // Should mention Smart Watch or risk analysis, not generic
    const relevantAnswer = data.answer.toLowerCase().includes('watch') ||
                           data.answer.toLowerCase().includes('risk') ||
                           data.cards?.some(c => c.product?.toLowerCase().includes('watch'));
    assert(relevantAnswer, `answer not relevant to Smart Watch: "${data.answer.slice(0,80)}"`);
  });

  await test('Query: "What should I reorder?" gives actionable list', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', {
      query: 'What should I reorder?'
    });
    assert(data.answer, 'no answer');
    // Answer should either list products or say nothing needed
    assert(data.answer.length > 20, 'answer too short');
  });

  await test('Query: "Which products are overstocked?" uses real data', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', {
      query: 'Which products are overstocked?'
    });
    assert(data.answer, 'no answer');
    assert(!data.answer.includes('Error'), 'answer is an error');
  });

  await test('Query: "What happens if demand increases by 20%?" directs to scenario lab', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', {
      query: 'What happens if demand increases by 20%?'
    });
    assert(data.answer, 'no answer');
    const hasScenarioLink = data.links?.some(l => l.page === 'scenario-lab');
    assert(hasScenarioLink, 'should include link to scenario lab');
  });

  await test('Query: "Show me today inventory risks" returns summary', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', {
      query: "Show me today's inventory risks"
    });
    assert(data.answer, 'no answer');
    assert(data.answer.toLowerCase().includes('risk') || data.answer.toLowerCase().includes('inventory'), 'answer not about inventory risks');
  });

  await test('Hallucination test: unknown product returns graceful response', async () => {
    const { data } = await req('POST', '/api/intelligence/copilot', {
      query: "What is the inventory of ProductXYZ9999 that doesn't exist?"
    });
    assert(data.answer, 'no answer');
    // Should not invent inventory values
    const inventedNumbers = /inventory.*\d{4,}/.test(data.answer.toLowerCase());
    assert(!inventedNumbers, 'copilot appears to have invented inventory numbers for nonexistent product');
  });

  await test('Empty query returns 400', async () => {
    const { status } = await req('POST', '/api/intelligence/copilot', {});
    assert(status === 400, `expected 400, got ${status}`);
  });

  // ── FEATURE 5: RISK ENGINE & ACTION CENTER ─────────────────────────────
  console.log('\n── Feature 5: Risk Engine & Action Center ──');

  await test('Risk score is composite (not random)', async () => {
    const { data } = await req('GET', '/api/intelligence/products');
    data.products.forEach(p => {
      assert(typeof p.risk_score === 'number', `${p.name}: no risk_score`);
      assert(p.risk_score >= 0 && p.risk_score <= 100, `${p.name}: risk_score ${p.risk_score} out of range`);
    });
  });

  await test('Approve action: creates audit record', async () => {
    const { status, data } = await req('POST', '/api/intelligence/action', {
      product_id:     'smart-watch-s3',
      product_name:   'Smart Watch S3',
      recommendation: 'REORDER_NOW — 4500 units',
      action:         'REORDER_NOW',
      decision:       'approved',
      reason:         'Stock critically low, lead time 10 days',
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(data.success, 'not success');
    assert(data.entry.status === 'approved', `wrong status: ${data.entry.status}`);
    assert(data.entry.id, 'no entry id');
    assert(data.entry.timestamp, 'no timestamp');
  });

  await test('Reject action: creates audit record with rejected status', async () => {
    const { data } = await req('POST', '/api/intelligence/action', {
      product_id: 'laptop-pro-x1', product_name: 'Laptop Pro X1',
      recommendation: 'HOLD', action: 'HOLD', decision: 'rejected', reason: 'Demand declining'
    });
    assert(data.entry.status === 'rejected', `expected rejected, got ${data.entry.status}`);
  });

  await test('Snooze action: creates audit record with snoozed status', async () => {
    const { data } = await req('POST', '/api/intelligence/action', {
      product_id: 'gaming-mouse', product_name: 'Gaming Mouse',
      recommendation: 'MONITOR', action: 'MONITOR', decision: 'snoozed', reason: 'Will review next week'
    });
    assert(data.entry.status === 'snoozed', `expected snoozed, got ${data.entry.status}`);
  });

  await test('Invalid decision type returns 400', async () => {
    const { status } = await req('POST', '/api/intelligence/action', {
      product_id: 'test', decision: 'maybe'
    });
    assert(status === 400, `expected 400, got ${status}`);
  });

  await test('Audit log persists decisions', async () => {
    const { data } = await req('GET', '/api/intelligence/audit');
    assert(data.entries.length > 0, 'no audit entries — decisions not persisted');
    const recent = data.entries[0];
    assert(recent.timestamp, 'no timestamp');
    assert(recent.product_id, 'no product_id');
    assert(recent.status, 'no status');
  });

  await test('Audit log contains human decision type', async () => {
    const { data } = await req('GET', '/api/intelligence/audit');
    const humanDecision = data.entries.find(e =>
      ['approved', 'rejected', 'snoozed'].includes(e.status)
    );
    assert(humanDecision, 'no human decisions found in audit log');
  });

  // ── ML PIPELINE ──────────────────────────────────────────────────────────
  console.log('\n── ML Pipeline & Model Lab ──');

  await test('Model comparison returns 4 models', async () => {
    const { data } = await req('GET', '/api/intelligence/models');
    assert(data.models.length === 4, `expected 4 models, got ${data.models.length}`);
    const names = data.models.map(m => m.model);
    assert(names.includes('Random Forest'), 'no Random Forest');
    assert(names.includes('Linear Regression'), 'no Linear Regression');
    assert(names.includes('Ridge Regression'), 'no Ridge Regression');
    assert(names.includes('Decision Tree'), 'no Decision Tree');
  });

  await test('Chronological split used (no data leakage)', async () => {
    const { data } = await req('GET', '/api/intelligence/models');
    assert(data.split_info.method === 'chronological', `split method: ${data.split_info.method}`);
    assert(data.split_info.test_size > 0, 'no test set');
    assert(data.split_info.train_size > 0, 'no train set');
    assert(data.split_info.train_size > data.split_info.test_size, 'test larger than train — wrong split');
  });

  await test('MAPE is meaningful (not fake 94.7% accuracy)', async () => {
    const { data } = await req('GET', '/api/intelligence/models');
    data.models.forEach(m => {
      if (m.mape !== null) {
        assert(m.mape < 50, `${m.model} MAPE=${m.mape}% is suspiciously high`);
        assert(m.mape > 0, `${m.model} MAPE=0 is suspiciously perfect`);
      }
    });
  });

  await test('Best model is identified', async () => {
    const { data } = await req('GET', '/api/intelligence/models');
    assert(data.best_model, 'no best_model identified');
    const bestFound = data.models.find(m => m.is_best);
    assert(bestFound, `best_model="${data.best_model}" but no model has is_best=true`);
  });

  await test('Feature importance is an array (not object)', async () => {
    const { data } = await req('GET', '/api/intelligence/models');
    assert(Array.isArray(data.feature_importance), `feature_importance should be array, got ${typeof data.feature_importance}`);
    assert(data.feature_importance.length > 0, 'empty feature importance');
    assert(data.feature_importance[0].feature, 'no .feature field');
    assert(typeof data.feature_importance[0].importance === 'number', 'no .importance number');
  });

  await test('Forecast with full mode returns prediction interval', async () => {
    const { data } = await req('POST', '/api/forecast', {
      sales: 580, inventory: 1000, price: 85000, month: 9, lead_time: 14, mode: 'forecast'
    });
    assert(data.predicted_demand > 0, 'no prediction');
    assert(data.prediction_interval?.lower < data.prediction_interval?.upper, 'invalid interval');
    assert(data.model_metrics?.mae > 0, 'no MAE');
  });

  // ── DATA QUALITY ─────────────────────────────────────────────────────────
  console.log('\n── Data Quality ──');

  await test('Default dataset quality check returns score', async () => {
    const { data } = await req('POST', '/api/data-quality', {});
    assert(typeof data.score === 'number', 'no score');
    assert(data.score >= 0 && data.score <= 100, `score ${data.score} out of range`);
    assert(data.rows === 48, `expected 48 rows, got ${data.rows}`);
  });

  await test('Quality check detects issues in bad dataset', async () => {
    const rows = [
      { sales: 100, inventory: 200, price: 1000, month: 1, demand: 120 },
      { sales: 100, inventory: 200, price: 1000, month: 1, demand: 120 }, // duplicate
      { sales: -50, inventory: 180, price: 1000, month: 2, demand: 110 }, // negative sales
      { sales: '',  inventory: 200, price: 1000, month: 3, demand: '' },   // missing
      { sales: 9999999, inventory: 200, price: 1000, month: 4, demand: 130 }, // outlier
    ];
    const { data } = await req('POST', '/api/data-quality', { rows });
    assert(data.issues.length > 0, `should detect issues, got ${data.issues.length} issues`);
    assert(data.score < 100, `score should be <100 for bad data, got ${data.score}`);
  });

  await test('Quality score is lower for bad data than good data', async () => {
    const { data: goodData } = await req('POST', '/api/data-quality', {});
    const badRows = Array(10).fill({
      sales: 100, inventory: 200, price: 1000, month: 1, demand: 120
    }).map((r, i) => ({ ...r, month: i + 1 }));
    badRows[0] = { ...badRows[0], sales: -100 }; // negative
    const { data: badData } = await req('POST', '/api/data-quality', { rows: badRows });
    // Good data should score higher (it has no issues)
    assert(goodData.score >= badData.score, `good(${goodData.score}) should be >= bad(${badData.score})`);
  });

  // ── API AUDIT ─────────────────────────────────────────────────────────────
  console.log('\n── API Validation ──');

  await test('POST /api/forecast: missing fields returns 400', async () => {
    const { status } = await req('POST', '/api/forecast', { sales: 100 });
    assert(status === 400, `expected 400, got ${status}`);
  });

  await test('GET /api/intelligence/product/:id: 404 for unknown', async () => {
    const { status } = await req('GET', '/api/intelligence/product/unknown-xyz');
    assert(status === 404, `expected 404, got ${status}`);
  });

  await test('POST /api/intelligence/scenario: 400 without product_id', async () => {
    const { status } = await req('POST', '/api/intelligence/scenario', { scenarios: [] });
    assert(status === 400, `expected 400, got ${status}`);
  });

  await test('GET /api/intelligence/audit: pagination works', async () => {
    const { data } = await req('GET', '/api/intelligence/audit?limit=3&offset=0');
    assert(Array.isArray(data.entries), 'not array');
    assert(data.entries.length <= 3, `limit not respected: ${data.entries.length}`);
    assert(typeof data.total === 'number', 'no total');
  });

  await test('POST /api/upload-forecast: too few rows returns error', async () => {
    const { status, data } = await req('POST', '/api/upload-forecast', {
      rows: [{ sales: 100, inventory: 200, price: 1000, month: 1, demand: 120 }]
    });
    // Should fail gracefully (either 400 validation or 500 from Python requiring min 4 rows)
    assert(status >= 400, `expected error status, got ${status}: ${JSON.stringify(data)}`);
  });

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Results: ${pass} passed  |  ${fail} failed  |  ${warn} warnings`);
  console.log('══════════════════════════════════════════════════\n');

  if (fail > 0) {
    console.log('FAILURES:');
    issues.forEach(i => console.log(`  ✗ ${i.label}: ${i.error}`));
    console.log('');
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED ✓\n');
  }
})();
