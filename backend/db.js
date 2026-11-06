/**
 * db.js — lightweight JSON file store (no native compilation needed)
 * Stores data in backend/data.json
 * Structure: { users: [], otps: [], scenarios: [], datasets: [], actions: [], suppliers: [], purchaseRequests: [], purchaseOrders: [], goodsReceipts: [], inventoryTransactions: [] }
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data.json');
let cachedData = null;
let cachedSignature = null;

function getDatabaseSignature() {
  const stat = fs.statSync(DB_PATH);
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

/* ── Load / initialise ──────────────────────────────────────────────────── */
function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], otps: [], scenarios: [], datasets: [], actions: [], suppliers: [], purchaseRequests: [], purchaseOrders: [], goodsReceipts: [], inventoryTransactions: [] }, null, 2));
  }
  const signature = getDatabaseSignature();
  if (cachedData && cachedSignature === signature) return cachedData;

  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  let changed = false;
  const supportedUsers = (data.users || []).filter(user => user.role !== 'CUSTOMER');
  changed = supportedUsers.length !== (data.users || []).length;
  data.users = supportedUsers.map(user => {
    const normalized = {
      ...user,
      name: user.name || [user.first_name, user.last_name].filter(Boolean).join(' ').trim(),
      passwordHash: user.passwordHash || user.password,
      role: ['ADMIN', 'MANAGER', 'PROCUREMENT', 'WAREHOUSE'].includes(user.role) ? user.role : 'MANAGER',
      status: ['ACTIVE', 'INACTIVE'].includes(user.status) ? user.status : 'ACTIVE',
      createdAt: user.createdAt || user.created_at || new Date().toISOString(),
      updatedAt: user.updatedAt || user.createdAt || user.created_at || new Date().toISOString(),
    };
    if (JSON.stringify(normalized) !== JSON.stringify(user)) changed = true;
    return normalized;
  });
  ['suppliers', 'purchaseRequests', 'purchaseOrders', 'goodsReceipts', 'inventoryTransactions'].forEach(collection => {
    if (!Array.isArray(data[collection])) { data[collection] = []; changed = true; }
  });
  if (changed) {
    save(data);
  } else {
    cachedData = data;
    cachedSignature = signature;
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  cachedData = data;
  cachedSignature = getDatabaseSignature();
}

/* ── Users ──────────────────────────────────────────────────────────────── */
function findUserByEmail(email) {
  const { users } = load();
  return users.find(u => u.email && u.email.toLowerCase() === email.trim().toLowerCase()) || null;
}

function findUserByPhone(phone) {
  const { users } = load();
  const norm = normalisePhone(phone);
  return users.find(u => u.phone && normalisePhone(u.phone) === norm) || null;
}

function findUserById(id) {
  const { users } = load();
  return users.find(u => u.id === id) || null;
}

function insertUser({ firstName, lastName, name, email, phone, password, passwordHash, role = 'MANAGER', status = 'ACTIVE' }) {
  const db = load();
  const now = new Date().toISOString();
  const displayName = name || [firstName, lastName].filter(Boolean).join(' ').trim();
  const hash = passwordHash || password;
  const user = {
    id: uuidv4(),
    name: displayName,
    first_name: firstName || displayName,
    last_name: lastName || '',
    email: email ? email.trim().toLowerCase() : null,
    phone: phone ? normalisePhone(phone) : null,
    passwordHash: hash,
    password: hash,
    role,
    status,
    verified: false,
    createdAt: now,
    updatedAt: now,
    created_at: now,
  };
  db.users.push(user);
  save(db);
  return user;
}

function markUserVerified(id) {
  const db = load();
  const user = db.users.find(u => u.id === id);
  if (user && !user.verified) { user.verified = true; save(db); }
}

function listUsers() { return load().users; }

function updateUser(id, updates) {
  const data = load();
  const user = data.users.find(item => item.id === id);
  if (!user) return null;
  Object.assign(user, updates, { updatedAt: new Date().toISOString() });
  if (updates.name) user.first_name = updates.name;
  save(data);
  return user;
}

function deleteUser(id) {
  const data = load();
  const before = data.users.length;
  data.users = data.users.filter(user => user.id !== id);
  if (data.users.length === before) return false;
  save(data);
  return true;
}

function listScenarios(userId) {
  return (load().scenarios || []).filter(scenario => scenario.userId === userId);
}

function getUserPreferences(userId) {
  const user = load().users.find(item => item.id === userId);
  return user?.preferences || {};
}

function updateUserPreferences(userId, preferences) {
  const data = load();
  const user = data.users.find(item => item.id === userId);
  if (!user) return null;
  user.preferences = { ...(user.preferences || {}), ...preferences };
  user.updatedAt = new Date().toISOString();
  save(data);
  return user.preferences;
}

function insertScenario({ userId, name, productId, input, result }) {
  const data = load();
  const scenario = {
    id: uuidv4(), userId, name, productId, input, result,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  data.scenarios = data.scenarios || [];
  data.scenarios.unshift(scenario);
  save(data);
  return scenario;
}

function deleteScenario(id, userId) {
  const data = load();
  const before = (data.scenarios || []).length;
  data.scenarios = (data.scenarios || []).filter(scenario => !(scenario.id === id && scenario.userId === userId));
  if (data.scenarios.length === before) return false;
  save(data);
  return true;
}

function insertDataset({ userId, name, headers, rows }) {
  const data = load();
  const dataset = {
    id: uuidv4(), userId, name, headers, rows,
    rowCount: rows.length, columnCount: headers.length,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  data.datasets = data.datasets || [];
  data.datasets.unshift(dataset);
  save(data);
  return dataset;
}

function listDatasets(userId) {
  return (load().datasets || []).filter(dataset => dataset.userId === userId);
}

function findDataset(id, userId) {
  return listDatasets(userId).find(dataset => dataset.id === id) || null;
}

function deleteDataset(id, userId) {
  const data = load();
  const before = (data.datasets || []).length;
  data.datasets = (data.datasets || []).filter(dataset => !(dataset.id === id && dataset.userId === userId));
  if (data.datasets.length === before) return false;
  save(data);
  return true;
}

function findAction(productId, userId) {
  return (load().actions || []).find(action => action.productId === productId && action.userId === userId) || null;
}

function upsertAction({ actionId, productId, status, recommendation, userId, reason }) {
  const data = load();
  data.actions = data.actions || [];
  const now = new Date().toISOString();
  let action = data.actions.find(item => item.actionId === actionId);
  if (!action) {
    action = { actionId, productId, createdAt: now };
    data.actions.push(action);
  }
  Object.assign(action, { status, recommendation, userId, reason: reason || '', timestamp: now, updatedAt: now });
  save(data);
  return action;
}

function listSuppliers(userId) {
  return userId ? (load().suppliers || []).filter(supplier => !supplier.userId || supplier.userId === userId) : (load().suppliers || []);
}

function insertSupplier({ userId, name, contactPerson, email, phone, address, products, leadTime, status = 'ACTIVE' }) {
  const data = load();
  const supplier = { id: uuidv4(), userId, name, contactPerson: contactPerson || '', email: email || '', phone: phone || '', address: address || '', products: Array.isArray(products) ? products : [], leadTime: Number(leadTime) || 0, status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  data.suppliers = data.suppliers || [];
  data.suppliers.unshift(supplier);
  save(data);
  return supplier;
}

function updateSupplier(id, userId, updates) {
  const data = load();
  const supplier = (data.suppliers || []).find(item => item.id === id && (userId === undefined || !item.userId || item.userId === userId));
  if (!supplier) return null;
  Object.assign(supplier, updates, { updatedAt: new Date().toISOString() });
  save(data);
  return supplier;
}

function insertPurchaseRequest(request) {
  const data = load();
  data.purchaseRequests = data.purchaseRequests || [];
  const existing = data.purchaseRequests.find(item => item.actionId === request.actionId);
  if (existing) return existing;
  const record = { id: uuidv4(), requestId: `PR-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'APPROVED', ...request };
  data.purchaseRequests.unshift(record);
  save(data);
  return record;
}

function listPurchaseRequests() { return load().purchaseRequests || []; }

function updatePurchaseRequest(id, updates) {
  const data = load();
  const request = (data.purchaseRequests || []).find(item => item.id === id);
  if (!request) return null;
  Object.assign(request, updates, { updatedAt: new Date().toISOString() });
  save(data);
  return request;
}

function insertPurchaseOrder(order) {
  const data = load();
  data.purchaseOrders = data.purchaseOrders || [];
  const existingNumbers = new Set(data.purchaseOrders.map(item => item.poNumber));
  let sequence = Date.now();
  while (existingNumbers.has(`PO-${sequence}`)) sequence += 1;
  const record = { id: uuidv4(), poNumber: `PO-${sequence}`, orderDate: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'DRAFT', ...order };
  data.purchaseOrders.unshift(record);
  save(data);
  return record;
}

function listPurchaseOrders() { return load().purchaseOrders || []; }

function updatePurchaseOrder(id, updates) {
  const data = load();
  const order = (data.purchaseOrders || []).find(item => item.id === id);
  if (!order) return null;
  Object.assign(order, updates, { updatedAt: new Date().toISOString() });
  save(data);
  return order;
}

function insertGoodsReceipt(receipt) {
  const data = load();
  data.goodsReceipts = data.goodsReceipts || [];
  const record = { id: uuidv4(), receiptNumber: `GR-${Date.now()}`, receivedAt: new Date().toISOString(), ...receipt };
  data.goodsReceipts.unshift(record);
  save(data);
  return record;
}

function listGoodsReceipts() { return load().goodsReceipts || []; }

function insertInventoryTransaction(transaction) {
  const data = load();
  data.inventoryTransactions = data.inventoryTransactions || [];
  const record = { id: uuidv4(), timestamp: new Date().toISOString(), ...transaction };
  data.inventoryTransactions.unshift(record);
  save(data);
  return record;
}

function listInventoryTransactions() { return load().inventoryTransactions || []; }

function updateProductInventory(userId, productName, quantity) {
  const data = load();
  const preferences = data.users.find(user => user.id === userId)?.preferences || {};
  const datasets = (data.datasets || []).filter(dataset => dataset.userId === userId);
  const dataset = datasets.find(item => item.id === preferences.activeDatasetId) || datasets[0];
  if (!dataset) return null;
  const rows = dataset.rows.filter(row => row.product === productName);
  const row = rows[rows.length - 1];
  if (!row) return null;
  row.inventory = Number(row.inventory || 0) + Number(quantity || 0);
  dataset.updatedAt = new Date().toISOString();
  save(data);
  return { datasetId: dataset.id, inventory: row.inventory };
}

/* ── OTPs ───────────────────────────────────────────────────────────────── */
function insertOtp({ identifier, otp_hash, channel, purpose, expires_at }) {
  const db = load();
  const otp = {
    id: uuidv4(),
    identifier,
    otp_hash,
    channel,
    purpose,
    attempts: 0,
    expires_at,
    used: false,
    created_at: new Date().toISOString(),
  };
  db.otps.push(otp);
  save(db);
  return otp;
}

function findActiveOtp(identifier) {
  const { otps } = load();
  const now = new Date();
  return otps
    .filter(o => o.identifier === identifier && !o.used && new Date(o.expires_at) > now)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
}

function incrementOtpAttempts(id) {
  const db = load();
  const otp = db.otps.find(o => o.id === id);
  if (otp) { otp.attempts++; save(db); }
}

function markOtpUsed(id) {
  const db = load();
  const otp = db.otps.find(o => o.id === id);
  if (otp) { otp.used = true; save(db); }
}

function invalidateOtps(identifier) {
  const db = load();
  db.otps.filter(o => o.identifier === identifier && !o.used)
    .forEach(o => { o.used = true; });
  save(db);
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
function normalisePhone(p) {
  return (p || '').replace(/[\s\-().]/g, '');
}

module.exports = {
  findUserByEmail,
  findUserByPhone,
  findUserById,
  insertUser,
  listUsers,
  updateUser,
  deleteUser,
  listSuppliers,
  insertSupplier,
  updateSupplier,
  insertPurchaseRequest,
  listPurchaseRequests,
  updatePurchaseRequest,
  insertPurchaseOrder,
  listPurchaseOrders,
  updatePurchaseOrder,
  insertGoodsReceipt,
  listGoodsReceipts,
  insertInventoryTransaction,
  listInventoryTransactions,
  updateProductInventory,
  listScenarios,
  insertScenario,
  deleteScenario,
  insertDataset,
  listDatasets,
  findDataset,
  deleteDataset,
  findAction,
  upsertAction,
  markUserVerified,
  insertOtp,
  findActiveOtp,
  incrementOtpAttempts,
  markOtpUsed,
  invalidateOtps,
  normalisePhone,
  getUserPreferences,
  updateUserPreferences,
};
