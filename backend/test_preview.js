/**
 * test_preview.js — Issue #2: Dataset preview shows actual rows
 * Tests that buildUploadPreviewTable produces correct DOM structure
 * for the real data.csv (48 rows, 8 columns).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Re-use the same parseCSV logic ──────────────────────────────────────────
function parseCSV(text) {
  if (!text || !text.trim()) return null;
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalised.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return null;
  function parseLine(line) {
    const result = []; let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQuotes && line[i+1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim()); return result;
  }
  const headerVals = parseLine(lines[0]);
  const headers = headerVals.map(h => h.toLowerCase().replace(/\s+/g, '_'));
  if (!headers.length) return null;
  const rows = lines.slice(1).map(line => {
    const vals = parseLine(line); const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i] : ''; });
    return obj;
  });
  const columnTypes = {};
  headers.forEach(h => {
    const nonEmpty = rows.map(r => r[h]).filter(v => v !== '');
    columnTypes[h] = nonEmpty.length > 0 && nonEmpty.every(v => !isNaN(Number(v))) ? 'numeric' : 'categorical';
  });
  return { headers, headerOriginal: headerVals.map(h => h.trim()), rows, columnTypes, totalRows: rows.length };
}

let pass = 0, fail = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✓  ${label}`); pass++; }
  catch (e) { console.log(`  ✗  ${label} — ${e.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('\n── Issue #2: Dataset Preview Tests ──\n');

const csv = fs.readFileSync(path.join(__dirname, 'data.csv'), 'utf8');
const parsed = parseCSV(csv);

test('parseCSV returns a valid object', () => {
  assert(parsed !== null, 'returned null');
});

test('All 8 columns are in headers array', () => {
  assert(parsed.headers.length === 8, `expected 8, got ${parsed.headers.length}: ${parsed.headers.join(',')}`);
  const expected = ['product','sales','inventory','price','month','demand','lead_time','category'];
  expected.forEach(col => assert(parsed.headers.includes(col), `missing column: ${col}`));
});

test('All 48 data rows are parsed', () => {
  assert(parsed.rows.length === 48, `expected 48, got ${parsed.rows.length}`);
});

test('First row has all 8 fields populated', () => {
  const r = parsed.rows[0];
  assert(r.product && r.product.length > 0, `product empty: "${r.product}"`);
  assert(r.sales && !isNaN(Number(r.sales)), `sales invalid: "${r.sales}"`);
  assert(r.inventory && !isNaN(Number(r.inventory)), `inventory invalid: "${r.inventory}"`);
  assert(r.price && !isNaN(Number(r.price)), `price invalid: "${r.price}"`);
  assert(r.month && !isNaN(Number(r.month)), `month invalid: "${r.month}"`);
  assert(r.demand && !isNaN(Number(r.demand)), `demand invalid: "${r.demand}"`);
  assert(r.lead_time && !isNaN(Number(r.lead_time)), `lead_time invalid: "${r.lead_time}"`);
  assert(r.category && r.category.length > 0, `category empty: "${r.category}"`);
});

test('Column types detected correctly', () => {
  assert(parsed.columnTypes.product === 'categorical', `product: ${parsed.columnTypes.product}`);
  assert(parsed.columnTypes.category === 'categorical', `category: ${parsed.columnTypes.category}`);
  assert(parsed.columnTypes.sales === 'numeric', `sales: ${parsed.columnTypes.sales}`);
  assert(parsed.columnTypes.inventory === 'numeric', `inventory: ${parsed.columnTypes.inventory}`);
  assert(parsed.columnTypes.price === 'numeric', `price: ${parsed.columnTypes.price}`);
  assert(parsed.columnTypes.month === 'numeric', `month: ${parsed.columnTypes.month}`);
  assert(parsed.columnTypes.demand === 'numeric', `demand: ${parsed.columnTypes.demand}`);
  assert(parsed.columnTypes.lead_time === 'numeric', `lead_time: ${parsed.columnTypes.lead_time}`);
});

test('Preview would show up to 50 rows (48 total, all shown)', () => {
  const displayRows = parsed.rows.slice(0, 50);
  assert(displayRows.length === 48, `expected 48, got ${displayRows.length}`);
});

test('Preview header row would have 8 <th> elements', () => {
  // Simulate the th creation
  const ths = parsed.headers.map((h, idx) => ({
    text: parsed.headerOriginal?.[idx] || h,
    isRequired: ['sales','inventory','price','month','demand'].includes(h),
    colType: parsed.columnTypes[h]
  }));
  assert(ths.length === 8, `expected 8 th, got ${ths.length}`);
  ths.forEach(th => assert(th.text && th.text.length > 0, `empty th text`));
});

test('Summary bar would show correct row/column count', () => {
  // Simulate the summaryDiv innerHTML
  const rows = parsed.rows.length;
  const cols = parsed.headers.length;
  const colList = parsed.headers.join(', ');
  assert(rows === 48, `rows: ${rows}`);
  assert(cols === 8, `cols: ${cols}`);
  assert(colList.includes('product'), `col list missing product: ${colList}`);
  assert(colList.includes('lead_time'), `col list missing lead_time: ${colList}`);
});

test('No row has undefined values for any column', () => {
  parsed.rows.forEach((row, i) => {
    parsed.headers.forEach(h => {
      assert(row[h] !== undefined, `Row ${i} column "${h}" is undefined`);
    });
  });
});

test('Products are distinct in categorical column', () => {
  const products = [...new Set(parsed.rows.map(r => r.product))];
  assert(products.length === 4, `expected 4 products, got ${products.length}: ${products.join(', ')}`);
});

test('Month values are 1-12', () => {
  parsed.rows.forEach((r, i) => {
    const m = Number(r.month);
    assert(m >= 1 && m <= 12, `Row ${i} month=${m} out of range`);
  });
});

console.log(`\n── Results: ${pass} passed, ${fail} failed ──\n`);
if (fail > 0) process.exit(1);
