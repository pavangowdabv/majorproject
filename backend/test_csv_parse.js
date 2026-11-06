/**
 * test_csv_parse.js
 * Tests the new parseCSV and validateCSVStructure logic against real and edge-case CSVs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── Inline the JS functions (same logic as script.js) ─────────────────────
const REQUIRED_COLS = ['sales', 'inventory', 'price', 'month', 'demand'];

function parseCSV(text) {
  if (!text || !text.trim()) return null;
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalised.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return null;

  function parseLine(line) {
    const result = [];
    let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim()); current = '';
      } else { current += ch; }
    }
    result.push(current.trim());
    return result;
  }

  const headerVals = parseLine(lines[0]);
  const headers = headerVals.map(h => h.toLowerCase().replace(/\s+/g, '_'));
  if (!headers.length) return null;

  const rows = lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj = {};
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

function validateCSVStructure(parsed) {
  if (!parsed) return { ok: false, error: 'File is empty or unreadable.', warnings: [], summary: null };
  const warnings = [];
  const missing = REQUIRED_COLS.filter(c => !parsed.headers.includes(c));
  if (missing.length) return { ok: false, error: `Missing: ${missing.join(', ')}`, warnings, summary: null };

  let blankRows = 0, nonNumericRows = 0, negativeRows = 0;
  parsed.rows.forEach(r => {
    if (REQUIRED_COLS.some(c => r[c] === '' || r[c] === undefined)) blankRows++;
    if (REQUIRED_COLS.some(c => r[c] !== '' && isNaN(Number(r[c])))) nonNumericRows++;
    if (REQUIRED_COLS.filter(c => c !== 'month').some(c => Number(r[c]) < 0)) negativeRows++;
  });

  if (nonNumericRows > 0) return { ok: false, error: `${nonNumericRows} non-numeric rows`, warnings, summary: null };

  const validRows = parsed.rows.filter(r => REQUIRED_COLS.every(c => r[c] !== '' && !isNaN(Number(r[c]))));
  if (validRows.length < 2) return { ok: false, error: `Only ${validRows.length} valid rows`, warnings, summary: null };
  if (blankRows > 0) warnings.push(`${blankRows} rows will be skipped`);
  if (negativeRows > 0) warnings.push(`${negativeRows} rows have negative values`);

  const months = validRows.map(r => Number(r.month)).filter(v => !isNaN(v));
  return {
    ok: true, error: null, warnings,
    summary: {
      totalRows: parsed.rows.length, validRows: validRows.length,
      skippedRows: parsed.rows.length - validRows.length,
      columns: parsed.headers.length, columnTypes: parsed.columnTypes,
      hasProduct: parsed.headers.includes('product'),
      hasLeadTime: parsed.headers.includes('lead_time'),
      monthRange: months.length ? `${Math.min(...months)}–${Math.max(...months)}` : '—',
    }
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;

function test(label, fn) {
  try { fn(); console.log(`  ✓  ${label}`); pass++; }
  catch (e) { console.log(`  ✗  ${label} — ${e.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('\n── Issue #1: CSV Parsing Tests ──\n');

// Test 1: Real data.csv
test('Real data.csv — 48 rows, 8 columns, all valid', () => {
  const text = fs.readFileSync(path.join(__dirname, 'data.csv'), 'utf8');
  const p = parseCSV(text);
  assert(p, 'parseCSV returned null');
  assert(p.totalRows === 48, `expected 48 rows, got ${p.totalRows}`);
  assert(p.headers.length === 8, `expected 8 headers, got ${p.headers.length}`);
  assert(p.headers.includes('product'), 'missing product column');
  assert(p.headers.includes('lead_time'), 'missing lead_time column');
  const v = validateCSVStructure(p);
  assert(v.ok, `validation failed: ${v.error}`);
  assert(v.summary.validRows === 48, `expected 48 valid rows, got ${v.summary.validRows}`);
  assert(v.summary.hasProduct === true, 'hasProduct should be true');
  assert(v.summary.hasLeadTime === true, 'hasLeadTime should be true');
});

// Test 2: Minimal required-only CSV
test('Minimal CSV — 5 required columns only', () => {
  const csv = `sales,inventory,price,month,demand\n100,200,500,1,120\n110,190,510,2,130\n`;
  const p = parseCSV(csv);
  assert(p, 'parseCSV returned null');
  assert(p.totalRows === 2, `expected 2 rows, got ${p.totalRows}`);
  const v = validateCSVStructure(p);
  assert(v.ok, `failed: ${v.error}`);
  assert(v.summary.hasProduct === false, 'hasProduct should be false');
});

// Test 3: Missing required column
test('Missing required column — should fail validation', () => {
  const csv = `sales,inventory,price,month\n100,200,500,1\n110,190,510,2\n`;
  const p = parseCSV(csv);
  const v = validateCSVStructure(p);
  assert(!v.ok, 'should have failed validation');
  assert(v.error.includes('demand'), `error should mention missing column: ${v.error}`);
});

// Test 4: Non-numeric value in required column
test('Non-numeric in required column — should fail', () => {
  const csv = `sales,inventory,price,month,demand\n100,200,500,1,120\nN/A,190,510,2,130\n`;
  const p = parseCSV(csv);
  const v = validateCSVStructure(p);
  assert(!v.ok, 'should fail due to non-numeric');
  assert(v.error.includes('non-numeric'), `error: ${v.error}`);
});

// Test 5: Quoted fields (comma inside a value)
test('Quoted fields — comma inside product name', () => {
  const csv = `product,sales,inventory,price,month,demand\n"Laptop, Pro X1",620,1200,80000,10,700\n"Gaming Mouse",695,760,2600,10,830\n`;
  const p = parseCSV(csv);
  assert(p, 'parseCSV returned null for quoted CSV');
  assert(p.totalRows === 2, `expected 2 rows, got ${p.totalRows}`);
  assert(p.rows[0].product === 'Laptop, Pro X1', `wrong product: ${p.rows[0].product}`);
});

// Test 6: Windows \r\n line endings
test('Windows CRLF line endings', () => {
  const csv = `sales,inventory,price,month,demand\r\n100,200,500,1,120\r\n110,190,510,2,130\r\n`;
  const p = parseCSV(csv);
  assert(p, 'parseCSV returned null for CRLF');
  assert(p.totalRows === 2, `expected 2 rows, got ${p.totalRows}`);
  const v = validateCSVStructure(p);
  assert(v.ok, `failed: ${v.error}`);
});

// Test 7: Empty file
test('Empty CSV — returns null', () => {
  const p = parseCSV('');
  assert(p === null, 'should return null for empty string');
});

// Test 8: Header only
test('Header-only CSV — returns null', () => {
  const p = parseCSV('sales,inventory,price,month,demand\n');
  assert(p === null, 'should return null for header-only');
});

// Test 9: Column type detection
test('Column type detection — numeric vs categorical', () => {
  const csv = `product,sales,inventory,price,month,demand\nLaptop,620,1200,80000,10,700\nMouse,695,760,2600,10,830\n`;
  const p = parseCSV(csv);
  assert(p.columnTypes.product === 'categorical', `product should be categorical, got ${p.columnTypes.product}`);
  assert(p.columnTypes.sales === 'numeric', `sales should be numeric, got ${p.columnTypes.sales}`);
  assert(p.columnTypes.month === 'numeric', `month should be numeric, got ${p.columnTypes.month}`);
});

// Test 10: Rows with blank cells are kept but flagged
test('Blank cells — rows kept in preview, validation warns', () => {
  const csv = `sales,inventory,price,month,demand\n100,200,500,1,120\n,190,510,2,130\n110,190,510,3,140\n`;
  const p = parseCSV(csv);
  assert(p.totalRows === 3, `expected 3 total rows (blank kept), got ${p.totalRows}`);
  const v = validateCSVStructure(p);
  assert(v.ok, `should pass (2+ valid rows): ${v.error}`);
  assert(v.summary.validRows === 2, `expected 2 valid, got ${v.summary.validRows}`);
  assert(v.summary.skippedRows === 1, `expected 1 skipped, got ${v.summary.skippedRows}`);
  assert(v.warnings.length > 0, 'should have a warning about skipped rows');
});

// Test 11: Negative values — warning but still valid
test('Negative values — validation warns but passes', () => {
  const csv = `sales,inventory,price,month,demand\n100,200,500,1,120\n-50,190,510,2,130\n110,190,510,3,140\n`;
  const p = parseCSV(csv);
  const v = validateCSVStructure(p);
  assert(v.ok, `should pass: ${v.error}`);
  assert(v.warnings.some(w => w.includes('negative')), 'should warn about negative values');
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${pass} passed, ${fail} failed ──\n`);
if (fail > 0) process.exit(1);
