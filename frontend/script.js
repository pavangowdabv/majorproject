/* ================================================================
   ForecastAI Enterprise — script.js v3.0
   All data from real backend APIs. No hardcoded product arrays.
   ================================================================ */

// Change this to your deployed backend URL when hosting online
// e.g. 'https://your-backend.onrender.com/api'
const API = (window.BACKEND_URL || 'http://localhost:4000') + '/api';
let currentUser = null;
const ROLE_PAGES = {
  ADMIN: ['dashboard', 'intelligence-center', 'forecast', 'upload', 'analytics', 'alerts', 'ml', 'reports', 'settings', 'scenario-lab', 'copilot', 'action-center', 'model-lab', 'audit', 'data-quality', 'user-management', 'procurement', 'purchase-requests', 'purchase-orders', 'suppliers', 'deliveries', 'inventory-transactions'],
  MANAGER: ['dashboard', 'intelligence-center', 'forecast', 'upload', 'analytics', 'alerts', 'ml', 'reports', 'scenario-lab', 'copilot', 'action-center', 'audit', 'data-quality', 'procurement', 'purchase-requests', 'purchase-orders', 'suppliers', 'deliveries', 'inventory-transactions'],
  PROCUREMENT: ['procurement', 'purchase-requests', 'purchase-orders', 'suppliers', 'deliveries'],
  WAREHOUSE: ['warehouse', 'deliveries', 'inventory-transactions'],
};

/* ── Chart registry ── */
const charts = {};
function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

/* ── Chart defaults ── */
function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { labels: { color: '#6b7280', font: { size: 11, weight: '600' } } },
      tooltip: {
        backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8',
        cornerRadius: 8, padding: 11, borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1
      }
    },
    scales: {
      x: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(0,0,0,0.05)' } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(0,0,0,0.05)' } }
    }
  };
}

/* ── Toast ── */
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

/* ── Loading overlay ── */
function showLoading(ms = 0) {
  const o = document.getElementById('loadingOverlay');
  if (o) o.classList.add('show');
  return new Promise(res => setTimeout(() => { if (o) o.classList.remove('show'); res(); }, ms));
}
function hideLoading() {
  const o = document.getElementById('loadingOverlay');
  if (o) o.classList.remove('show');
}

/* ── Currency formatter ── */
function fmtCurrency(val) {
  const n = Number(val);
  if (isNaN(n)) return '—';
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}
function fmtNum(val) {
  const n = Number(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-IN');
}
function fmtPct(val) {
  const n = Number(val);
  if (isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/* ── Risk badge HTML ── */
function riskBadge(level) {
  const l = (level || 'unknown').toLowerCase();
  const icons = { critical: 'circle-exclamation', high: 'triangle-exclamation', medium: 'minus-circle', low: 'circle-check', unknown: 'circle' };
  const icon = icons[l] || 'circle';
  return `<span class="risk-badge risk-${l}"><i class="fa-solid fa-${icon}"></i> ${l.charAt(0).toUpperCase() + l.slice(1)}</span>`;
}

/* ── API fetch helper ── */
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers || {} };
  if (options.headers) {
    options.headers = { ...options.headers, 'Content-Type': 'application/json' };
  } else {
    options.headers = { 'Content-Type': 'application/json' };
  }
  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (_) {
    throw new Error('Unable to connect to the reporting service.');
  }
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/health')) {
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_token');
      window.location.href = 'auth/login.html';
    }
    const errText = await res.text().catch(() => 'Unknown error');
    let message = `Request failed (${res.status}).`;
    try {
      const payload = JSON.parse(errText);
      message = typeof payload.error === 'string' ? payload.error : payload.error?.message || message;
    } catch (_) { }
    if (res.status === 401) message = 'Your session has expired.';
    throw new Error(message);
  }
  return res.json();
}

/* ── Uploaded CSV state ── */
let uploadedCSVData = null;
let uploadedFileName = '';
let uploadedDatasetId = localStorage.getItem('forecastai_dataset_id') || null;
let activeModel = localStorage.getItem('forecastai_active_model') || 'Random Forest';
let dqUploadedRows = null;
const REQUIRED_COLS = ['sales', 'inventory', 'price', 'month', 'demand'];

/* ================================================================
   NAVIGATION
   ================================================================ */
const PAGE_TITLES = {
  dashboard: 'Dashboard', 'intelligence-center': 'Intelligence Center', forecast: 'Forecast', alerts: 'Alerts',
  'scenario-lab': 'Scenario Lab', copilot: 'ForecastIQ Copilot', 'action-center': 'Action Center',
  'model-lab': 'Model Lab', upload: 'Dataset', analytics: 'Analytics', reports: 'Reports',
  procurement: 'Procurement Dashboard', warehouse: 'Warehouse Dashboard', 'purchase-requests': 'Purchase Requests',
  'purchase-orders': 'Purchase Orders', suppliers: 'Suppliers', deliveries: 'Incoming Deliveries', 'inventory-transactions': 'Inventory Transactions',
  audit: 'Audit Log', 'data-quality': 'Data Quality', settings: 'Settings', ml: 'ML Predict'
};
let pendingSearchProduct = null;

function navigateTo(page) {
  const allowed = ROLE_PAGES[currentUser?.role] || [];
  if (!allowed.includes(page)) {
    showToast('You do not have access to this page.');
    page = 'dashboard';
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page;

  if (page === 'dashboard') initDashboard();
  else if (page === 'intelligence-center') initIntelligenceCenter();
  else if (page === 'forecast') initForecastPage();
  else if (page === 'alerts') initAlertsPage();
  else if (page === 'scenario-lab') initScenarioLab();
  else if (page === 'copilot') initCopilot();
  else if (page === 'action-center') initActionCenter();
  else if (page === 'model-lab') initModelLab();
  else if (page === 'analytics') buildAnalyticsCharts();
  else if (page === 'reports') buildReportsTable();
  else if (page === 'audit') initAudit();
  else if (page === 'data-quality') initDataQuality();
  else if (page === 'ml') initMlPage();
  else if (page === 'user-management') loadUsers();
  else if (['procurement', 'warehouse', 'purchase-requests', 'purchase-orders', 'suppliers', 'deliveries', 'inventory-transactions'].includes(page)) initOperationsPage(page);
}

function applyRoleNavigation() {
  const allowed = ROLE_PAGES[currentUser?.role] || [];
  document.querySelectorAll('.nav-item').forEach(item => {
    item.style.display = allowed.includes(item.dataset.page) ? '' : 'none';
  });
  document.querySelectorAll('.nav-section-label').forEach(label => {
    let next = label.nextElementSibling;
    let visible = false;
    while (next && !next.classList.contains('nav-section-label')) {
      if (next.classList.contains('nav-item') && next.style.display !== 'none') visible = true;
      next = next.nextElementSibling;
    }
    label.style.display = visible ? '' : 'none';
  });
}

async function loadCurrentUser() {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = 'auth/login.html';
    return false;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (res.status === 401) {
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_token');
      window.location.href = 'auth/login.html';
      return false;
    }
    if (!res.ok) throw new Error(`Authentication failed (${res.status})`);
    const data = await res.json();
    currentUser = data.user;
    localStorage.setItem('auth_user', JSON.stringify(currentUser));
    applyRoleNavigation();
    const greeting = document.getElementById('userGreeting');
    const identifier = document.getElementById('userIdentifier');
    const role = document.getElementById('userRole');
    if (greeting) greeting.textContent = `Hi, ${currentUser.name || currentUser.firstName || 'there'}`;
    if (identifier) identifier.textContent = currentUser.email || currentUser.phone || '';
    if (role) role.textContent = currentUser.role;
    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      showToast('Authentication check timed out — check the backend connection');
    } else {
      showToast('Cannot reach the authentication service — check the backend connection');
    }
    document.body.setAttribute('data-auth-state', 'error');
    return false;
  }
}

async function loadUsers() {
  const params = new URLSearchParams();
  const query = document.getElementById('userSearch')?.value.trim();
  const role = document.getElementById('userRoleFilter')?.value;
  const status = document.getElementById('userStatusFilter')?.value;
  if (query) params.set('q', query);
  if (role) params.set('role', role);
  if (status) params.set('status', status);
  const data = await apiFetch(`${API}/admin/users?${params}`);
  const body = document.getElementById('usersTableBody');
  if (!body) return;
  body.innerHTML = data.users.map(user => `<tr><td>${user.name || '—'}</td><td>${user.email || '—'}</td><td><strong>${user.role}</strong></td><td>${user.status}</td><td><button class="icon-btn" title="Change role" onclick="changeUserRole('${user.id}', '${user.role}')"><i class="fa-solid fa-user-pen"></i></button><button class="icon-btn" title="Toggle status" onclick="toggleUserStatus('${user.id}', '${user.status}')"><i class="fa-solid fa-power-off"></i></button><button class="icon-btn" title="Delete user" onclick="deleteManagedUser('${user.id}')"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') || '<tr><td colspan="5">No users found.</td></tr>';
}

async function changeUserRole(id, currentRole) {
  const role = window.prompt('Role (ADMIN, PROCUREMENT, WAREHOUSE):', currentRole);
  if (!role || !['ADMIN', 'PROCUREMENT', 'WAREHOUSE'].includes(role.toUpperCase())) return;
  await apiFetch(`${API}/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: role.toUpperCase() }) });
  loadUsers();
}
async function toggleUserStatus(id, status) {
  await apiFetch(`${API}/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) });
  loadUsers();
}
async function deleteManagedUser(id) {
  if (!window.confirm('Delete this user permanently?')) return;
  await apiFetch(`${API}/admin/users/${id}`, { method: 'DELETE' });
  loadUsers();
}
async function createManagedUser() {
  const name = window.prompt('Full name:');
  const email = window.prompt('Email:');
  const password = window.prompt('Temporary password (8+ characters):');
  const role = window.prompt('Role (ADMIN, PROCUREMENT, WAREHOUSE):', 'PROCUREMENT');
  if (!name || !email || !password || !role) return;
  await apiFetch(`${API}/admin/users`, { method: 'POST', body: JSON.stringify({ name, email, password, role: role.toUpperCase() }) });
  loadUsers();
}

/* ================================================================
   PROCUREMENT AND WAREHOUSE OPERATIONS
   ================================================================ */
async function initOperationsPage(page) {
  const output = document.getElementById(`${page}Content`);
  if (!output) return;
  output.innerHTML = '<div class="loading-state">Loading live procurement records...</div>';
  try {
    if (page === 'procurement' || page === 'warehouse') {
      const data = await apiFetch(`${API}/procurement/dashboard`);
      const cards = page === 'procurement'
        ? [['Pending Requests', data.pendingRequests], ['Approved Requests', data.approvedRequests], ['Purchase Orders', data.purchaseOrders], ['Awaiting Supplier', data.awaitingSupplier], ['In Transit', data.inTransit], ['Expected Deliveries', data.expectedDeliveries], ['Completed Orders', data.completedOrders], ['Procurement Value', fmtCurrency(data.totalProcurementValue)]]
        : [['Pending Receipts', data.pendingReceipts], ["Today's Deliveries", data.todaysExpectedDeliveries], ['In Transit', data.inTransit], ['Received Today', data.receivedToday], ['Inventory Updates', data.receivedToday], ['Damaged / Short', data.damagedShortDeliveries], ['Completed Receipts', data.completedReceipts]];
      output.innerHTML = `<div class="kpi-grid-6">${cards.map(card => `<div class="kpi-card"><div class="kpi-info"><span class="kpi-label">${card[0]}</span><span class="kpi-value">${card[1]}</span></div></div>`).join('')}</div><div class="glass-card" style="padding:20px;margin-top:18px"><h3>${page === 'procurement' ? 'Procurement workflow' : 'Warehouse receiving workflow'}</h3><p class="page-sub">Live records are available in the operational views.</p></div>`;
      return;
    }
    if (page === 'purchase-requests') {
      const data = await apiFetch(`${API}/procurement/purchase-requests`);
      output.innerHTML = `<div class="table-wrapper"><table><thead><tr><th>Request ID</th><th>Product</th><th>Quantity</th><th>Inventory</th><th>Risk</th><th>Priority</th><th>Requested / Approved</th><th>Status</th><th></th></tr></thead><tbody>${(data.requests || []).map(request => `<tr><td>${escapeHtml(request.requestId)}</td><td>${escapeHtml(request.product)}</td><td>${fmtNum(request.quantity)}</td><td>${fmtNum(request.currentInventory)}</td><td>${fmtPct(request.stockoutRisk)}</td><td>${riskBadge(request.priority)}</td><td>${escapeHtml(request.requestedBy)} / ${escapeHtml(request.approvedByName)}</td><td>${escapeHtml(request.status)}</td><td>${request.status === 'APPROVED' ? `<button class="glass-btn-sm" onclick="createPurchaseOrder('${request.id}')">Create PO</button>` : request.purchaseOrderId ? `<button class="glass-btn-sm" onclick="viewPurchaseOrder('${request.purchaseOrderId}','${request.id}')">View PO</button>` : 'PO link unavailable'}</td></tr>`).join('') || '<tr><td colspan="9">No purchase requests found.</td></tr>'}</tbody></table></div>`;
      return;
    }
    if (page === 'purchase-orders' || page === 'deliveries') {
      const data = await apiFetch(`${API}/procurement/purchase-orders`);
      output.innerHTML = `<div class="table-wrapper"><table><thead><tr><th>PO Number</th><th>Supplier</th><th>Product</th><th>Quantity</th><th>Total</th><th>Expected Delivery</th><th>Status</th><th></th></tr></thead><tbody>${(data.orders || []).map(order => `<tr><td><button class="link-btn" onclick="viewPurchaseOrder('${order.id}','${order.purchaseRequestId || ''}')">${escapeHtml(order.poNumber)}</button></td><td>${escapeHtml(order.supplier?.name || '—')}</td><td>${escapeHtml(order.product)}</td><td>${fmtNum(order.quantity)}</td><td>${fmtCurrency(order.totalAmount)}</td><td>${escapeHtml(order.expectedDelivery || '—')}</td><td>${escapeHtml(order.status)}</td><td>${page === 'deliveries' && ['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'ORDERED', 'PURCHASE_ORDER_CREATED', 'DRAFT', 'SUBMITTED'].includes(order.status) ? `<button class="glass-btn-sm" onclick="receivePurchaseOrder('${order.id}')">Receive Goods</button>` : page === 'purchase-orders' && ['DRAFT', 'SUBMITTED', 'PURCHASE_ORDER_CREATED', 'ORDERED', 'IN_TRANSIT'].includes(order.status) ? `<button class="glass-btn-sm" onclick="updatePurchaseOrderStatus('${order.id}','${order.status}','${escapeHtml(order.poNumber)}')">Update Status</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8">No purchase orders found.</td></tr>'}</tbody></table></div>`;
      return;
    }
    if (page === 'suppliers') {
      const data = await apiFetch(`${API}/procurement/suppliers`);
      output.innerHTML = `<button class="predict-btn" onclick="addSupplier()">Add Supplier</button><div class="table-wrapper" style="margin-top:16px"><table><thead><tr><th>Supplier ID</th><th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th>Lead Time</th><th>Status</th><th></th></tr></thead><tbody>${(data.suppliers || []).map(supplier => `<tr><td>${escapeHtml(supplier.id)}</td><td>${escapeHtml(supplier.name)}</td><td>${escapeHtml(supplier.contactPerson)}</td><td>${escapeHtml(supplier.email)}</td><td>${escapeHtml(supplier.phone)}</td><td>${supplier.leadTime} days</td><td>${escapeHtml(supplier.status)}</td><td><button class="glass-btn-sm" onclick="editSupplier('${supplier.id}')">Edit</button> <button class="glass-btn-sm" onclick="toggleSupplier('${supplier.id}','${supplier.status}')">${supplier.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="8">No suppliers have been added.</td></tr>'}</tbody></table></div>`;
      return;
    }
    const data = await apiFetch(`${API}/procurement/inventory-transactions`);
    output.innerHTML = `<div class="table-wrapper"><table><thead><tr><th>Timestamp</th><th>Product</th><th>Quantity</th><th>Type</th><th>Purchase Order</th><th>Inventory After</th><th>Notes</th></tr></thead><tbody>${(data.transactions || []).map(item => `<tr><td>${new Date(item.timestamp).toLocaleString()}</td><td>${escapeHtml(item.product)}</td><td>${fmtNum(item.quantity)}</td><td>${escapeHtml(item.transactionType)}</td><td>${escapeHtml(item.purchaseOrderId)}</td><td>${fmtNum(item.inventoryAfter)}</td><td>${escapeHtml(item.notes || '')}</td></tr>`).join('') || '<tr><td colspan="7">No inventory receipts recorded.</td></tr>'}</tbody></table></div>`;
  } catch (error) { output.innerHTML = `<div class="validation-msg error" style="display:block">${escapeHtml(error.message)}</div>`; }
}

async function createPurchaseOrder(requestId) {
  const modal = document.getElementById('purchaseOrderModal');
  const supplierSelect = document.getElementById('poSupplierSelect');
  const message = document.getElementById('poSupplierMessage');
  const submit = document.getElementById('poSubmitBtn');
  if (!modal || !supplierSelect || !message || !submit) return;
  const requestData = await apiFetch(`${API}/procurement/purchase-requests`).catch(error => {
    showToast(error.message);
    return null;
  });
  const request = requestData?.requests?.find(item => item.id === requestId);
  if (!request) return showToast('Purchase Request not found.');
  if (request.status !== 'APPROVED') return showToast('Purchase Request is not approved.');
  modal.classList.add('show');
  supplierSelect.innerHTML = '<option value="">Loading suppliers...</option>';
  supplierSelect.disabled = true;
  submit.disabled = true;
  message.className = 'po-form-message';
  message.textContent = '';
  document.getElementById('poProduct').textContent = request.product || '—';
  document.getElementById('poQuantity').value = Number(request.recommendedOrderQuantity || request.quantity || 0);
  document.getElementById('poUnitPrice').value = Number(request.unitPrice || 0);
  document.getElementById('poExpectedDelivery').value = '';
  try {
    const data = await apiFetch(`${API}/procurement/suppliers`);
    const suppliers = (data.suppliers || []).filter(supplier => supplier.status === 'ACTIVE');
    if (!suppliers.length) {
      supplierSelect.innerHTML = '<option value="">No active suppliers available</option>';
      message.className = 'po-form-message error';
      message.textContent = 'No suppliers available. Add a supplier before creating a purchase order.';
      return;
    }
    supplierSelect.innerHTML = '<option value="">Select Supplier</option>' + suppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}" data-lead-time="${Number(supplier.leadTime) || 0}">${escapeHtml(supplier.name)} · ${escapeHtml(supplier.id)} · ${Number(supplier.leadTime) || 0} days · ${escapeHtml(supplier.status)}</option>`).join('');
    supplierSelect.disabled = false;
    submit.disabled = false;
    supplierSelect.onchange = () => {
      const selected = supplierSelect.selectedOptions[0];
      const details = document.getElementById('poSupplierDetails');
      if (details) details.textContent = selected?.value ? `Supplier ID: ${selected.value} · Lead time: ${selected.dataset.leadTime} days · Status: ACTIVE` : '';
    };
    submit.onclick = async () => {
      if (!supplierSelect.value) {
        message.className = 'po-form-message error';
        message.textContent = 'Select an active supplier before creating the purchase order.';
        return;
      }
      submit.disabled = true;
      message.className = 'po-form-message';
      message.textContent = 'Creating purchase order...';
      try {
        const response = await apiFetch(`${API}/procurement/purchase-orders`, {
          method: 'POST',
          body: JSON.stringify({ purchaseRequestId: requestId, supplierId: supplierSelect.value, quantity: Number(document.getElementById('poQuantity').value), unitPrice: Number(document.getElementById('poUnitPrice').value), expectedDelivery: document.getElementById('poExpectedDelivery').value })
        });
        closePurchaseOrderModal();
        showToast(`Purchase Order created successfully: ${response.order.poNumber}`);
        initOperationsPage('purchase-requests');
      } catch (error) {
        message.className = 'po-form-message error';
        message.textContent = error.message;
        submit.disabled = false;
      }
    };
  } catch (error) {
    supplierSelect.innerHTML = '<option value="">Unable to load suppliers</option>';
    message.className = 'po-form-message error';
    message.textContent = error.message;
  }
}

function closePurchaseOrderModal() {
  document.getElementById('purchaseOrderModal')?.classList.remove('show');
}

async function viewPurchaseOrder(purchaseOrderId, purchaseRequestId = '') {
  const endpoint = `${API}/procurement/purchase-orders/${encodeURIComponent(purchaseOrderId)}`;
  try {
    const { order } = await apiFetch(endpoint);
    const body = document.getElementById('explainModalBody');
    const title = document.getElementById('explainModalTitle');
    if (!body || !title) return;
    title.innerHTML = '<i class="fa-solid fa-file-signature"></i> Purchase Order Details';
    body.innerHTML = `<div class="report-section"><h3>${escapeHtml(order.poNumber)}</h3><div class="ic-result-grid"><div><b>${escapeHtml(order.product)}</b><small>Product</small></div><div><b>${fmtNum(order.quantity)}</b><small>Quantity</small></div><div><b>${escapeHtml(order.supplier?.name || '—')}</b><small>Supplier</small></div><div><b>${fmtCurrency(order.unitPrice)}</b><small>Unit Price</small></div><div><b>${fmtCurrency(order.totalAmount)}</b><small>Total Amount</small></div><div><b>${new Date(order.createdAt || order.orderDate).toLocaleString()}</b><small>Created Date</small></div><div><b>${escapeHtml(order.expectedDelivery || '—')}</b><small>Expected Delivery</small></div><div><b>${escapeHtml(order.status)}</b><small>Current Status</small></div></div><p class="ic-note">Purchase Request: ${escapeHtml(order.purchaseRequest?.requestId || purchaseRequestId || '—')}</p></div>`;
    document.getElementById('explainModalOverlay')?.classList.add('show');
  } catch (error) {
    console.error('Purchase Order could not be found', { purchaseRequestId, purchaseOrderId, endpoint, error: error.message });
    showToast('Purchase Order could not be found.');
  }
}

async function addSupplier() {
  const name = window.prompt('Supplier name:');
  if (!name) return;
  try { await apiFetch(`${API}/procurement/suppliers`, { method: 'POST', body: JSON.stringify({ name, contactPerson: window.prompt('Contact person:') || '', email: window.prompt('Email:') || '', phone: window.prompt('Phone:') || '', address: window.prompt('Address:') || '', products: [], leadTime: Number(window.prompt('Lead time (days):') || 0) }) }); showToast('Supplier added'); initOperationsPage('suppliers'); } catch (error) { showToast(error.message); }
}

async function toggleSupplier(id, status) {
  try { await apiFetch(`${API}/procurement/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify({ status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) }); initOperationsPage('suppliers'); } catch (error) { showToast(error.message); }
}

async function editSupplier(id) {
  const name = window.prompt('Supplier name:');
  if (!name) return;
  try { await apiFetch(`${API}/procurement/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify({ name, contactPerson: window.prompt('Contact person:') || '', email: window.prompt('Email:') || '', phone: window.prompt('Phone:') || '', address: window.prompt('Address:') || '', leadTime: Number(window.prompt('Lead time (days):') || 0) }) }); showToast('Supplier updated'); initOperationsPage('suppliers'); } catch (error) { showToast(error.message); }
}

async function updatePurchaseOrderStatus(id, currentStatus) {
  const modal = document.getElementById('purchaseOrderStatusModal');
  const select = document.getElementById('poStatusSelect');
  const submit = document.getElementById('poStatusSubmitBtn');
  const message = document.getElementById('poStatusMessage');
  if (!modal || !select || !submit || !message) return;
  const transitions = {
    DRAFT: ['SUBMITTED', 'CANCELLED'], SUBMITTED: ['ORDERED', 'CANCELLED'], PURCHASE_ORDER_CREATED: ['ORDERED', 'CANCELLED'],
    ORDERED: ['IN_TRANSIT', 'CANCELLED'], IN_TRANSIT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'DELIVERED', 'CANCELLED'],
    PARTIALLY_RECEIVED: ['RECEIVED', 'COMPLETED'], RECEIVED: ['COMPLETED']
  };
  const labels = { SUBMITTED: 'Submitted', ORDERED: 'Ordered', IN_TRANSIT: 'In Transit', PARTIALLY_RECEIVED: 'Partially Received', RECEIVED: 'Received', COMPLETED: 'Completed', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };
  const role = currentUser?.role || 'PROCUREMENT';
  const roleAllowed = role === 'WAREHOUSE' ? ['PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED'] : role === 'PROCUREMENT' ? ['SUBMITTED', 'ORDERED', 'IN_TRANSIT', 'CANCELLED'] : Object.keys(labels);
  const nextStatuses = (transitions[currentStatus] || []).filter(status => roleAllowed.includes(status));
  select.innerHTML = nextStatuses.map(status => `<option value="${status}">${labels[status] || status}</option>`).join('');
  if (!nextStatuses.length) {
    message.className = 'po-form-message error'; message.textContent = currentStatus === 'COMPLETED' ? 'This Purchase Order is already completed.' : 'No status changes are available for your role.'; return;
  }
  document.getElementById('poStatusNumber').textContent = arguments[2] || id;
  message.className = 'po-form-message'; message.textContent = '';
  modal.classList.add('show'); submit.disabled = false;
  submit.onclick = async () => {
    submit.disabled = true; message.textContent = 'Updating...';
    try {
      const response = await apiFetch(`${API}/procurement/purchase-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
      closePurchaseOrderStatusModal();
      showToast(`Purchase Order status updated successfully. ${response.order.poNumber} is now ${labels[response.order.status] || response.order.status}.`);
      initOperationsPage('purchase-orders');
    } catch (error) {
      message.className = 'po-form-message error'; message.textContent = error.message; submit.disabled = false;
    }
  };
}

function closePurchaseOrderStatusModal() { document.getElementById('purchaseOrderStatusModal')?.classList.remove('show'); }

async function receivePurchaseOrder(id) {
  const receivedQuantity = Number(window.prompt('Received quantity:'));
  const damagedQuantity = Number(window.prompt('Damaged quantity:') || 0);
  const shortQuantity = Number(window.prompt('Short quantity:') || 0);
  const notes = window.prompt('Receiving notes:') || '';
  if (![receivedQuantity, damagedQuantity, shortQuantity].every(Number.isFinite)) return showToast('Enter valid receipt quantities.');
  try { await apiFetch(`${API}/procurement/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ receivedQuantity, damagedQuantity, shortQuantity, notes }) }); showToast('Goods receipt saved and inventory updated'); initOperationsPage('deliveries'); } catch (error) { showToast(error.message); }
}

/* ================================================================
   DASHBOARD
   ================================================================ */
async function initDashboard() {
  try {
    const data = await apiFetch(`${API}/intelligence/dashboard`);
    const { kpis, products, action_items } = data;

    /* KPI cards */
    setEl('kpi-revenue', fmtCurrency(kpis.total_revenue));
    setEl('kpi-demand', fmtNum(kpis.predicted_demand) + ' <small>units</small>');
    setEl('kpi-risk', fmtCurrency(kpis.revenue_at_risk));
    setEl('kpi-critical', kpis.critical_skus ?? '—');
    setEl('kpi-overstock', kpis.overstock_skus ?? '—');
    setEl('kpi-confidence', fmtPct(kpis.avg_forecast_confidence));

    const critSub = document.getElementById('kpi-critical-sub');
    if (critSub) critSub.textContent = `${kpis.high_risk_skus ?? 0} high risk`;

    const confSub = document.getElementById('kpi-confidence-sub');
    if (confSub) { confSub.innerHTML = '<i class="fa-solid fa-arrow-trend-up"></i> AI model'; confSub.className = 'kpi-change positive'; }

    /* Action items badge */
    const badge = document.getElementById('actionBadge');
    const count = (action_items || []).length;
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }

    /* Dash action required section */
    renderDashActions(action_items || []);

    /* Action count label */
    const countEl = document.getElementById('dashActionCount');
    if (countEl) countEl.textContent = count;

    /* Charts */
    buildDashDemandChart(products || []);
    buildDashRiskPie(products || []);

    /* Product table */
    renderDashProductTable(products || []);

  } catch (err) {
    console.error('Dashboard error:', err);
    showToast('Failed to load dashboard data. Check backend connection.');
    setEl('kpi-revenue', 'No data available');
    setEl('kpi-demand', 'No data available');
  }
}

function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

async function initIntelligenceCenter() {
  const status = document.getElementById('intelligenceStatus');
  if (status) status.textContent = 'Loading live calculations...';
  try {
    const data = await apiFetch(`${API}/intelligence/dashboard`);
    const k = data.kpis || {};
    setEl('icConfidence', fmtPct(k.avg_forecast_confidence));
    setEl('icRisk', `${k.critical_skus || 0} critical / ${k.high_risk_skus || 0} high`);
    setEl('icBudget', 'Enter below');
    setEl('icActions', fmtNum(k.action_items || 0));
    setEl('icInventoryValue', fmtCurrency(k.inventory_value));
    setEl('icProductCount', `${(data.products || []).length} active products from the current dataset`);
    const risky = (data.products || []).filter(product => ['critical', 'high'].includes(product.risk_level));
    const categories = new Set(risky.map(product => product.category).filter(Boolean));
    const leadingRisk = risky[0]?.name;
    setEl('icSituationSummary', risky.length
      ? `Demand intelligence flags ${risky.length} high-risk product${risky.length === 1 ? '' : 's'} across ${categories.size || 1} categor${categories.size === 1 ? 'y' : 'ies'}. ${leadingRisk} currently has the highest calculated risk; review the recommended actions below.`
      : 'Current forecasts show no high or critical inventory risks. Continue monitoring demand coverage and model confidence.');
    const productSelect = document.getElementById('icProduct');
    if (productSelect && data.products?.length) productSelect.innerHTML = data.products.map(product => `<option value="${product.id}">${product.name}</option>`).join('');
    if (status) status.textContent = `Live dataset processed at ${new Date(data.generated_at).toLocaleTimeString()}`;
  } catch (error) {
    if (status) status.textContent = `Unable to load intelligence data: ${error.message}`;
  }
}

async function runModelHealth() {
  const box = document.getElementById('modelHealthResult');
  if (box) box.innerHTML = '<div class="loading-state">Evaluating actual validation metrics...</div>';
  try {
    const data = await apiFetch(`${API}/intelligence/model-health`);
    box.innerHTML = `<div class="ic-result-grid"><div><b>${data.current_model || '—'}</b><small>Current model</small></div><div><b>${data.current_metrics?.rmse ?? '—'}</b><small>Current RMSE</small></div><div><b>${data.recommended_model || '—'}</b><small>Best validated model</small></div></div><p class="ic-note">Status: <strong>${data.status}</strong>. ${data.retraining.required ? 'A lower-RMSE alternative was found; activation is withheld until a persisted baseline validation is available.' : 'No lower-RMSE alternative was found.'}</p>`;
  } catch (error) { box.innerHTML = `<div class="validation-msg error" style="display:block">${error.message}</div>`; }
}

async function runDigitalTwin() {
  const box = document.getElementById('twinResult');
  box.innerHTML = '<div class="loading-state">Projecting inventory from live forecasts...</div>';
  try { const data = await apiFetch(`${API}/intelligence/digital-twin`); box.innerHTML = `<div class="ic-table"><div class="ic-table-row ic-table-head"><span>Product</span><span>Inventory</span><span>30-day demand</span><span>Projected</span><span>Risk</span></div>${data.products.map(p => `<div class="ic-table-row"><span>${p.name}</span><span>${fmtNum(p.inventory)}</span><span>${fmtNum(p.predicted_demand)}</span><span>${fmtNum(p.projected_inventory)}</span><span>${riskBadge(p.risk_level)}</span></div>`).join('')}</div>`; } catch (error) { box.innerHTML = `<div class="validation-msg error" style="display:block">${error.message}</div>`; }
}

async function runWhatIf() {
  const box = document.getElementById('whatIfResult');
  const product = document.getElementById('icProduct')?.value;
  box.innerHTML = '<div class="loading-state">Running scenario calculation...</div>';
  try { const data = await apiFetch(`${API}/intelligence/simulate`, { method: 'POST', body: JSON.stringify({ product_id: product, demand_change: Number(document.getElementById('icDemand').value), inventory_change: Number(document.getElementById('icInventory').value), supplier_delay: Number(document.getElementById('icDelay').value), price_change: Number(document.getElementById('icPrice').value) }) }); const s = data.simulated; box.innerHTML = `<div class="ic-result-grid"><div><b>${fmtNum(s.expected_demand)}</b><small>Expected demand</small></div><div><b>${fmtNum(s.inventory)}</b><small>Expected inventory</small></div><div><b>${s.stockout_probability}%</b><small>Stockout probability</small></div><div><b>${fmtCurrency(s.expected_revenue)}</b><small>Expected revenue</small></div><div><b>${fmtNum(s.recommended_order_quantity)}</b><small>Recommended order</small></div></div>`; } catch (error) { box.innerHTML = `<div class="validation-msg error" style="display:block">${error.message}</div>`; }
}

async function runAgents() { const box = document.getElementById('agentsResult'); box.innerHTML = '<div class="loading-state">Running deterministic decision agents...</div>'; try { const data = await apiFetch(`${API}/intelligence/agents`); const a = data.agents; box.innerHTML = `<div class="agent-grid"><div><b>Demand</b><p>${a.demand.recommendation}</p></div><div><b>Inventory</b><p>${a.inventory.status} Order ${fmtNum(a.inventory.recommended_order_quantity)} units.</p></div><div><b>Risk</b><p>${a.risk.level}: ${(a.risk.factors || []).slice(0, 2).join(' ')}</p></div><div><b>Finance</b><p>Purchase value ${fmtCurrency(a.finance.estimated_purchase_value)}.</p></div><div class="agent-decision"><b>Decision: ${a.decision.action}</b><p>${fmtNum(a.decision.quantity)} units at ${a.decision.confidence}% calculated confidence. ${a.decision.reasoning}</p></div></div>`; } catch (error) { box.innerHTML = `<div class="validation-msg error" style="display:block">${error.message}</div>`; } }

async function runOptimizer() { const box = document.getElementById('optimizerResult'); const budget = Number(document.getElementById('icBudgetInput').value); box.innerHTML = '<div class="loading-state">Allocating budget against calculated risk...</div>'; try { const data = await apiFetch(`${API}/intelligence/optimize`, { method: 'POST', body: JSON.stringify({ budget }) }); box.innerHTML = `<div class="ic-result-grid"><div><b>${fmtCurrency(data.recommended_spend)}</b><small>Recommended spend</small></div><div><b>${fmtCurrency(data.remaining_budget)}</b><small>Remaining budget</small></div></div><div class="ic-table">${data.allocation.filter(p => p.quantity > 0).map(p => `<div class="ic-table-row"><span>${p.product}</span><span>${fmtNum(p.quantity)} units</span><span>${fmtCurrency(p.spend)}</span><span>${p.rationale}</span></div>`).join('') || '<div class="ic-note">No purchase can be made within this budget.</div>'}</div>`; } catch (error) { box.innerHTML = `<div class="validation-msg error" style="display:block">${error.message}</div>`; } }

function renderDashActions(items) {
  const container = document.getElementById('dash-actions');
  if (!container) return;
  const top3 = items.slice(0, 3);
  if (!top3.length) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><i class="fa-solid fa-circle-check"></i><h3>All clear!</h3><p>No urgent actions required</p></div>';
    return;
  }
  container.innerHTML = top3.map(item => `
    <div class="dash-action-item">
      ${riskBadge(item.risk_level)}
      <div class="dash-action-text">
        <div class="dash-action-label">${item.product_name}</div>
        <div class="dash-action-sub">${item.action} — ${item.reason || ''}</div>
      </div>
      <span style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap">${fmtCurrency(item.revenue_at_risk)} at risk</span>
      <button class="glass-btn-sm" onclick="navigateTo('action-center')">Act <i class="fa-solid fa-arrow-right"></i></button>
    </div>
  `).join('');
}

function buildDashDemandChart(products) {
  destroyChart('dashDemand');
  const ctx = document.getElementById('dashDemandChart');
  if (!ctx || !products.length) return;
  const labels = products.map(p => p.name || p.id);
  const actual = products.map(p => p.sales || 0);
  const forecast = products.map(p => p.predicted_demand || 0);
  const g = ctx.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(37,99,235,0.18)'); grad.addColorStop(1, 'rgba(37,99,235,0)');
  charts['dashDemand'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Current Sales', data: actual, backgroundColor: 'rgba(37,99,235,0.65)', borderRadius: 6 },
        { label: 'Predicted Demand', data: forecast, backgroundColor: 'rgba(5,150,105,0.65)', borderRadius: 6 }
      ]
    },
    options: { ...chartDefaults(), animation: { duration: 1000 } }
  });
}

function buildDashRiskPie(products) {
  destroyChart('dashRiskPie');
  const ctx = document.getElementById('dashRiskPie');
  if (!ctx || !products.length) return;
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  products.forEach(p => { const l = (p.risk_level || 'low').toLowerCase(); if (counts[l] !== undefined) counts[l]++; else counts.low++; });
  charts['dashRiskPie'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'High', 'Medium', 'Low'],
      datasets: [{ data: [counts.critical, counts.high, counts.medium, counts.low], backgroundColor: ['#dc2626', '#ea580c', '#d97706', '#059669'], borderWidth: 2, borderColor: '#ffffff' }]
    },
    options: { responsive: true, maintainAspectRatio: true, animation: { duration: 300 }, plugins: { legend: { position: 'bottom', labels: { color: '#6b7280', font: { size: 11 }, padding: 10 } }, tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', cornerRadius: 8 } } }
  });
}

let _dashProducts = [];
function renderDashProductTable(products, filter = '') {
  _dashProducts = products;
  const tbody = document.getElementById('dashTableBody');
  if (!tbody) return;
  const filtered = products.filter(p => (p.name || p.id || '').toLowerCase().includes(filter.toLowerCase()));
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:20px"><i class="fa-solid fa-box-open"></i><h3>No products found</h3></div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const sp = Math.round(p.stockout_probability || 0); // already 0-100
    const barColor = sp > 70 ? '#dc2626' : sp > 40 ? '#d97706' : '#059669';
    return `<tr>
      <td><strong>${p.name || p.id}</strong></td>
      <td><span style="font-size:0.75rem;color:var(--text-muted)">${p.category || '—'}</span></td>
      <td>${fmtNum(p.predicted_demand)}</td>
      <td>${fmtNum(p.inventory)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="stockout-bar-wrap"><div class="stockout-bar-fill" style="width:${sp}%;background:${barColor};height:100%;border-radius:3px"></div></div>
          <span style="font-size:0.75rem;font-weight:700;color:${barColor}">${sp}%</span>
        </div>
      </td>
      <td>${riskBadge(p.risk_level)}</td>
      <td><button class="glass-btn-sm" onclick="showProductDetail('${p.id}')"><i class="fa-solid fa-eye"></i> Details</button></td>
    </tr>`;
  }).join('');
}

async function showProductDetail(productId) {
  try {
    document.getElementById('loadingOverlay').classList.add('show');
    const data = await apiFetch(`${API}/intelligence/product/${productId}`);
    hideLoading();
    const { product, risk, explanation } = data;
    const body = document.getElementById('explainModalBody');
    const title = document.getElementById('explainModalTitle');
    if (title) title.innerHTML = `<i class="fa-solid fa-magnifying-glass-chart"></i> ${product.name || productId}`;
    if (!body) return;
    const contribs = (explanation?.feature_contributions || risk?.feature_contributions || []);
    const maxContrib = Math.max(...contribs.map(c => Math.abs(c.contribution || 0)), 1);
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
        <div class="ml-metric"><span class="ml-metric-label">Predicted Demand</span><span class="ml-metric-val">${fmtNum(risk?.predicted_demand)}</span></div>
        <div class="ml-metric"><span class="ml-metric-label">Stockout Prob.</span><span class="ml-metric-val">${fmtPct(risk?.stockout_probability || 0)}</span></div>
        <div class="ml-metric"><span class="ml-metric-label">Coverage Days</span><span class="ml-metric-val">${risk?.inventory_coverage_days ?? '—'}</span></div>
        <div class="ml-metric"><span class="ml-metric-label">Reorder Point</span><span class="ml-metric-val">${fmtNum(risk?.reorder_point)}</span></div>
        <div class="ml-metric"><span class="ml-metric-label">Safety Stock</span><span class="ml-metric-val">${fmtNum(risk?.safety_stock)}</span></div>
        <div class="ml-metric"><span class="ml-metric-label">Forecast Uncertainty</span><span class="ml-metric-val">${risk?.forecast_uncertainty?.interval_width ?? '—'}</span></div>
        <div class="ml-metric"><span class="ml-metric-label">Expected Profit</span><span class="ml-metric-val">${fmtCurrency(risk?.expected_profit)}</span></div>
        <div class="ml-metric"><span class="ml-metric-label">Revenue at Risk</span><span class="ml-metric-val">${fmtCurrency(risk?.revenue_at_risk)}</span></div>
      </div>
      <div style="margin-bottom:8px;font-size:0.82rem;font-weight:700;color:var(--text)">Feature Contributions</div>
      <div class="explain-panel">
        ${contribs.map(c => {
      const pct = Math.min(100, (Math.abs(c.contribution || 0) / maxContrib) * 100);
      const dir = (c.direction || c.contribution >= 0) ? 'positive' : 'negative';
      return `<div class="contrib-row">
            <span class="contrib-feature">${c.feature}</span>
            <div class="contrib-bar-wrap"><div class="contrib-bar ${dir}" style="width:${pct}%"></div></div>
            <span class="contrib-value">${c.contribution >= 0 ? '+' : ''}${Number(c.contribution).toFixed(1)}</span>
          </div>`;
    }).join('') || '<span style="color:var(--text-muted);font-size:0.8rem">No contribution data available</span>'}
      </div>
      <div style="margin-top:14px;padding:10px 14px;background:var(--surface2);border-radius:8px;font-size:0.78rem;color:var(--text-muted)">
        <strong style="color:var(--text)">Recommendation:</strong> ${risk?.recommended_action || '—'}<br>
        <span>${risk?.action_reason || ''}</span>
      </div>
    `;
    document.getElementById('explainModalOverlay').classList.add('show');
  } catch (err) {
    hideLoading();
    showToast(err.message.includes('404') ? 'No product details found' : `Unable to load product details: ${err.message}`);
  }
}

/* ================================================================
   DEMAND INTELLIGENCE (FORECAST PAGE)
   ================================================================ */
// Product defaults — matches the product catalogue in intelligence.js
let forecastProducts = [];
let lastForecastResult = null;

function setForecastPageState(type, message, actionHtml = '') {
  const box = document.getElementById('forecastResultBox');
  if (!box) return;
  const wrappers = {
    loading: 'validation-msg info',
    error: 'validation-msg error',
    success: 'validation-msg success',
    info: 'validation-msg info'
  };
  box.innerHTML = `<div class="${wrappers[type] || 'validation-msg info'}" style="display:block">${message}${actionHtml || ''}</div>`;
}

function setForecastChartMessage(message, detail = '') {
  const canvas = document.getElementById('forecastPageChart');
  const area = canvas?.parentElement;
  if (!area) return;
  const prev = area.querySelector('.forecast-empty-state');
  if (prev) prev.remove();
  const html = `<div class="forecast-empty-state" style="min-height:220px;display:flex;align-items:center;justify-content:center;flex-direction:column;border:1px dashed rgba(148,163,184,0.55);border-radius:12px;background:rgba(15,23,42,0.02);color:var(--text-muted);padding:24px;text-align:center;">
    <strong>${escapeHtml(message)}</strong>
    ${detail ? `<span style="font-size:0.78rem;line-height:1.5;max-width:560px">${escapeHtml(detail)}</span>` : ''}
  </div>`;
  area.insertAdjacentHTML('beforeend', html);
}

async function refreshForecastDatasetSelect() {
  const select = document.getElementById('forecastDataset');
  if (!select) return;
  try {
    const response = await apiFetch(`${API}/intelligence/datasets`);
    const datasets = response.datasets || [];
    const options = [{ id: 'default', name: 'Default dataset' }, ...datasets.map(dataset => ({ id: dataset.id, name: dataset.name || 'Dataset' }))];
    const current = uploadedDatasetId || select.value || 'default';
    select.innerHTML = options.map(opt => `<option value="${opt.id}">${opt.name}</option>`).join('');
    select.value = options.some(opt => opt.id === current) ? current : 'default';
    uploadedDatasetId = select.value === 'default' ? null : select.value;
    if (uploadedDatasetId) localStorage.setItem('forecastai_dataset_id', uploadedDatasetId);
  } catch (err) {
    console.warn('Forecast dataset load failed:', err.message);
    select.innerHTML = '<option value="default">Default dataset</option>';
    select.value = 'default';
  }
}

function hydrateForecastProductCatalogFromRows(rows = []) {
  const latestByProduct = new Map();
  rows.forEach(row => {
    const productName = row.product || row.name || row.product_name;
    if (!productName) return;
    const current = latestByProduct.get(productName) || {};
    latestByProduct.set(productName, { ...current, ...row });
  });
  return [...latestByProduct.values()].map(row => {
    const productName = row.product || row.name || row.product_name;
    const id = String(productName || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return {
      id: id || 'product',
      name: productName,
      sales: Number(row.sales ?? 0),
      inventory: Number(row.inventory ?? 0),
      price: Number(row.price ?? 0),
      month: Number(row.month ?? 1),
      lead_time: Number(row.lead_time ?? 7),
    };
  });
}

async function refreshForecastProductsForDataset() {
  const select = document.getElementById('forecastProduct');
  const datasetSelect = document.getElementById('forecastDataset');
  if (!select) return;

  try {
    let rows = [];
    if (datasetSelect && datasetSelect.value && datasetSelect.value !== 'default') {
      const datasetResponse = await apiFetch(`${API}/intelligence/datasets/${encodeURIComponent(datasetSelect.value)}`);
      rows = datasetResponse.dataset?.rows || [];
    } else {
      const response = await apiFetch(`${API}/intelligence/products`);
      rows = (response.products || []).map(product => ({
        product: product.name,
        sales: product.sales,
        inventory: product.inventory,
        price: product.price,
        month: product.month,
        lead_time: product.lead_time,
      }));
    }

    const catalog = hydrateForecastProductCatalogFromRows(rows);
    const selected = select.value;
    forecastProducts = catalog;
    if (!forecastProducts.length) throw new Error('No products are available in the active dataset.');
    select.innerHTML = forecastProducts.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    select.value = forecastProducts.some(item => item.id === selected) ? selected : forecastProducts[0].id;
    const product = forecastProducts.find(item => item.id === select.value);
    if (product) {
      const set = (id, value) => { const element = document.getElementById(id); if (element) element.value = value ?? ''; };
      set('fcSales', product.sales); set('fcInventory', product.inventory); set('fcPrice', product.price); set('fcMonth', product.month); set('fcLeadTime', product.lead_time);
    }
  } catch (error) {
    console.warn('Forecast products refresh failed:', error.message);
    forecastProducts = [];
    select.innerHTML = '<option value="">No products available</option>';
  }
}

async function initForecastPage() {
  const sel = document.getElementById('forecastProduct');
  const datasetSel = document.getElementById('forecastDataset');
  if (pendingSearchProduct && sel) {
    const option = [...sel.options].find(item => item.textContent.trim().toLowerCase() === pendingSearchProduct.toLowerCase());
    if (option) sel.value = option.value;
    pendingSearchProduct = null;
  }

  await refreshForecastDatasetSelect();

  try {
    await refreshForecastProductsForDataset();
  } catch (error) {
    setForecastPageState('error', 'Unable to load forecast products. Retry.');
    return;
  }

  if (datasetSel && !datasetSel._forecastBound) {
    datasetSel._forecastBound = true;
    datasetSel.addEventListener('change', async () => {
      uploadedDatasetId = datasetSel.value === 'default' ? null : datasetSel.value;
      if (uploadedDatasetId) localStorage.setItem('forecastai_dataset_id', uploadedDatasetId);
      const scenarioDataset = document.getElementById('scenarioDataset');
      if (scenarioDataset && [...scenarioDataset.options].some(option => option.value === datasetSel.value)) {
        scenarioDataset.value = datasetSel.value;
        scenarioDataset.dispatchEvent(new Event('change'));
      }
      await refreshForecastProductsForDataset();
      setForecastPageState('loading', 'Generating demand forecast...');
      await runForecastPrediction();
    });
  }

  sel?.addEventListener('change', () => {
    const product = forecastProducts.find(item => item.id === sel?.value);
    if (!product) return;
    const scenarioProduct = document.getElementById('scenarioProduct');
    if (scenarioProduct && [...scenarioProduct.options].some(option => option.value === sel.value)) scenarioProduct.value = sel.value;
    const set = (id, value) => { const element = document.getElementById(id); if (element) element.value = value ?? ''; };
    set('fcSales', product.sales); set('fcInventory', product.inventory); set('fcPrice', product.price); set('fcMonth', product.month); set('fcLeadTime', product.lead_time);
  });

  const applyProduct = () => {
    const product = forecastProducts.find(item => item.id === sel?.value);
    if (!product) return;
    const set = (id, value) => { const element = document.getElementById(id); if (element) element.value = value ?? ''; };
    set('fcSales', product.sales); set('fcInventory', product.inventory); set('fcPrice', product.price); set('fcMonth', product.month); set('fcLeadTime', product.lead_time);
  };
  if (sel && !sel._fcBound) {
    sel._fcBound = true;
    sel.addEventListener('change', applyProduct);
  }
  applyProduct();
}

async function runForecastPrediction() {
  const product = document.getElementById('forecastProduct')?.value || 'laptop-pro-x1';
  const sales = Number(document.getElementById('fcSales')?.value);
  const inventory = Number(document.getElementById('fcInventory')?.value);
  const price = Number(document.getElementById('fcPrice')?.value);
  const month = Number(document.getElementById('fcMonth')?.value);
  const lead_time = Number(document.getElementById('fcLeadTime')?.value);

  const box = document.getElementById('forecastResultBox');
  const chartWrap = document.getElementById('forecastPageChart')?.parentElement;
  if (box) box.innerHTML = '<div class="validation-msg info" style="display:block">Generating demand forecast...</div>';
  if (chartWrap) {
    const empty = chartWrap.querySelector('.forecast-empty-state');
    if (empty) empty.remove();
  }

  if (![sales, inventory, price, month, lead_time].every(Number.isFinite)) {
    setForecastPageState('error', 'No forecast data available for the selected product.');
    setForecastChartMessage('Not enough historical data to generate a reliable forecast.');
    return;
  }

  try {
    const datasetId = document.getElementById('forecastDataset')?.value;
    const datasetQuery = datasetId && datasetId !== 'default' ? `?datasetId=${encodeURIComponent(datasetId)}` : '';
    const detail = await apiFetch(`${API}/intelligence/product/${product}${datasetQuery}`);
    const detailHistory = Array.isArray(detail.history) ? detail.history : [];
    const data = await apiFetch(`${API}/forecast`, {
      method: 'POST',
      body: JSON.stringify({ sales, inventory, price, month, lead_time, datasetId: datasetId !== 'default' ? datasetId : undefined })
    });

    const { predicted_demand, recommended_stock, prediction_interval, model_metrics, feature_contributions } = data;
    const risk = detail.risk || {};
    const historyValues = detailHistory.map(row => Number(row.demand ?? row.actual_demand ?? row.actual ?? row.sales)).filter(Number.isFinite);
    const firstDemand = historyValues[0];
    const lastDemand = historyValues[historyValues.length - 1];
    const trendChange = Number.isFinite(firstDemand) && firstDemand !== 0 ? ((Number(predicted_demand) - firstDemand) / Math.abs(firstDemand)) * 100 : null;
    const trend = trendChange === null || Math.abs(trendChange) < 5 ? 'Stable' : trendChange > 0 ? 'Increasing' : 'Decreasing';
    const confidence = Number.isFinite(Number(prediction_interval?.confidence)) ? `${Math.round(Number(prediction_interval.confidence) * 100)}%` : 'Confidence unavailable';
    const contributionReason = (feature_contributions || []).filter(item => Math.abs(Number(item.contribution)) > 0).slice(0, 3).map(item => `${item.feature} ${Number(item.contribution) > 0 ? 'increased' : 'reduced'} the prediction`).join('; ');
    const decisionInsight = risk.recommended_action ? `${risk.recommended_action}: ${risk.action_reason || 'Based on the current forecast and inventory position.'}` : 'Inventory decision insight unavailable.';
    lastForecastResult = { product, predicted_demand, recommended_stock, prediction_interval, model_metrics, feature_contributions, risk };

    /* Result box */
    if (box) {
      box.innerHTML = `
        <div class="forecast-result-cards" style="grid-template-columns:repeat(2, 1fr)">
          <div class="result-card">
            <span class="result-label">Predicted Demand</span>
            <span class="result-value">${fmtNum(predicted_demand)}</span>
            <span class="result-unit">units</span>
          </div>
          <div class="result-card">
            <span class="result-label">Forecast Confidence</span>
            <span class="result-value" style="color:#059669">${confidence}</span>
          </div>
          <div class="result-card">
            <span class="result-label">Prediction Range</span>
            <span style="font-size:0.82rem;font-weight:700;color:var(--text-muted)">${fmtNum(prediction_interval?.lower ?? prediction_interval?.[0])} — ${fmtNum(prediction_interval?.upper ?? prediction_interval?.[1])} units</span>
          </div>
          <div class="result-card">
            <span class="result-label">Demand Trend</span>
            <span class="result-value" style="color:#059669">${trend === 'Increasing' ? '↑' : trend === 'Decreasing' ? '↓' : '→'} ${trend}</span>
            <span class="result-unit">Trend change: ${trendChange === null ? 'Unavailable' : `${trendChange >= 0 ? '+' : ''}${trendChange.toFixed(1)}%`}</span>
          </div>
          <div class="result-card" style="grid-column:1/-1">
            <span class="result-label">Forecast Horizon</span>
            <span style="font-size:0.82rem;font-weight:700;color:var(--text-muted)">${Number.isFinite(lead_time) ? `Next ${lead_time} days` : 'Unavailable'}</span>
          </div>
          ${model_metrics ? `<div class="result-card" style="grid-column:1/-1">
            <span class="result-label">Model Performance</span>
            <span style="font-size:0.85rem;font-weight:700;color:var(--accent)">MAE ${fmtNum(model_metrics.mae)} | RMSE ${fmtNum(model_metrics.rmse)} | R² ${model_metrics.r2 == null ? 'Unavailable' : model_metrics.r2}</span>
          </div>` : ''}
          <div class="result-card" style="grid-column:1/-1"><span class="result-label">Forecast Risk</span><span class="result-value">${risk.decision_risk || 'Unavailable'}</span></div>
          <div class="result-card" style="grid-column:1/-1"><span class="result-label">Why This Forecast?</span><span style="font-size:0.82rem;color:var(--text-muted)">${contributionReason || 'Feature contribution data unavailable.'}</span></div>
          <div class="result-card" style="grid-column:1/-1"><span class="result-label">Inventory Decision Insight</span><span style="font-size:0.82rem;color:var(--text-muted)">${decisionInsight}</span></div>
        </div>`;
    }

    /* Sub title */
    const sub = document.getElementById('fcChartSub');
    if (sub) sub.textContent = `${product.replace(/-/g, ' ')} — Demand forecast`;

    /* Chart */
    buildForecastPageChart({
      predicted: Number(predicted_demand),
      interval: prediction_interval,
      history: detailHistory,
      productName: product,
      forecastStartDate: detail.forecast_start_date
    });

    /* Feature contributions */
    if (feature_contributions && feature_contributions.length) {
      const panel = document.getElementById('fcContribPanel');
      const bars = document.getElementById('fcContribBars');
      if (panel) panel.style.display = '';
      if (bars) {
        const maxC = Math.max(...feature_contributions.map(c => Math.abs(c.contribution || 0)), 1);
        bars.innerHTML = feature_contributions.map(c => {
          const pct = Math.min(100, (Math.abs(c.contribution || 0) / maxC) * 100);
          const dir = (c.direction === 'positive' || Number(c.contribution) >= 0) ? 'positive' : 'negative';
          return `<div class="contrib-row">
            <span class="contrib-feature">${c.feature}</span>
            <div class="contrib-bar-wrap"><div class="contrib-bar ${dir}" style="width:${pct}%"></div></div>
            <span class="contrib-value">${Number(c.contribution) > 0 ? '↑ Positive' : Number(c.contribution) < 0 ? '↓ Negative' : '→ Neutral'} (${Number(c.contribution) >= 0 ? '+' : ''}${Number(c.contribution).toFixed(1)})</span>
          </div>`;
        }).join('');
      }
    }

    showToast(`Forecast: ${fmtNum(predicted_demand)} units demand predicted`);
  } catch (err) {
    console.error('Forecast request failed:', err);
    setForecastPageState('error', `Forecast unavailable. ${err.message || 'The model could not generate a forecast.'}<br><button class="glass-btn-sm" onclick="runForecastPrediction()" style="margin-top:8px;">Retry</button>`);
    setForecastChartMessage('Forecast unavailable', 'The model could not generate a prediction for this product and dataset. Retry to refresh the forecast.');
    showToast('Forecast unavailable. Check the backend or product data.');
  }
}

function buildForecastPageChart(arg1, arg2 = [], arg3 = []) {
  let predicted = arg1;
  let interval = arg2;
  let history = arg3;
  let forecastStartDate = null;

  if (typeof arg1 === 'object' && arg1 !== null) {
    predicted = Number(arg1.predicted ?? arg1.predicted_demand ?? arg1.value ?? 0);
    interval = arg1.interval ?? arg1.prediction_interval ?? arg1.range ?? {};
    history = Array.isArray(arg1.history) ? arg1.history : (Array.isArray(arg2) ? arg2 : []);
    forecastStartDate = arg1.forecastStartDate || null;
  }

  if (typeof predicted === 'string') predicted = Number(predicted);
  if (!Array.isArray(history)) history = [];

  destroyChart('forecastPage');
  const ctx = document.getElementById('forecastPageChart');
  if (!ctx) return;

  const safePredicted = Number(predicted);
  const safeLower = Number(interval?.lower ?? interval?.[0]);
  const safeUpper = Number(interval?.upper ?? interval?.[1]);

  const parent = ctx.parentElement;
  if (parent) {
    const prev = parent.querySelector('.forecast-empty-state');
    if (prev) prev.remove();
  }

  const normalizedHistory = Array.isArray(history) ? history
    .map(row => {
      const monthValue = Number(row.month ?? row.period_month ?? row.month_number ?? 1);
      const yearValue = Number(row.year ?? row.date?.slice(0, 4) ?? new Date().getFullYear());
      const dateValue = row.date || (Number.isFinite(yearValue) && Number.isFinite(monthValue) ? `${yearValue}-${String(monthValue).padStart(2, '0')}-01` : null);
      const actualValue = Number(row.demand ?? row.actual_demand ?? row.actual ?? row.sales ?? 0);
      return { ...row, dateValue, monthValue, yearValue, actualValue };
    })
    .filter(entry => Number.isFinite(entry.actualValue))
    .sort((a, b) => {
      const aTime = new Date(a.dateValue || `${a.yearValue}-${String(a.monthValue).padStart(2, '0')}-01`).getTime();
      const bTime = new Date(b.dateValue || `${b.yearValue}-${String(b.monthValue).padStart(2, '0')}-01`).getTime();
      return aTime - bTime;
    }) : [];

  if (!Number.isFinite(safePredicted) || !Number.isFinite(safeLower) || !Number.isFinite(safeUpper) || normalizedHistory.length < 3) {
    setForecastChartMessage('Not enough historical data to generate a reliable forecast.', 'This product does not have enough valid history for a dependable prediction. Use a dataset with more month-over-month demand values.');
    return;
  }

  const labels = normalizedHistory.map(row => {
    const date = new Date(row.dateValue || `${row.yearValue}-${String(row.monthValue).padStart(2, '0')}-01`);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : `Month ${row.monthValue}`;
  });
  const actualData = normalizedHistory.map(row => row.actualValue);
  const upperBound = [...actualData, safeUpper];
  const lowerBound = [...actualData, safeLower];
  const forecastData = [...Array(actualData.length).fill(null), safePredicted];
  const chartLabels = [...labels, forecastStartDate || 'FORECAST START'];

  const g = ctx.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, 'rgba(37,99,235,0.18)'); grad.addColorStop(1, 'rgba(37,99,235,0)');
  charts['forecastPage'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [
        { label: 'Actual Demand', data: [...actualData, null], borderColor: '#2563eb', backgroundColor: grad, fill: true, tension: 0.35, pointRadius: 4, borderWidth: 2.5 },
        { label: 'Forecasted Demand', data: forecastData, borderColor: '#059669', borderDash: [6, 6], fill: false, tension: 0.35, pointRadius: 4, borderWidth: 2.6 },
        { label: 'Upper Bound', data: upperBound, borderColor: 'rgba(5,150,105,0.45)', borderDash: [4, 4], fill: false, tension: 0.35, pointRadius: 0 },
        { label: 'Lower Bound', data: lowerBound, borderColor: 'rgba(217,119,6,0.45)', borderDash: [4, 4], backgroundColor: 'rgba(5,150,105,0.10)', fill: '-1', tension: 0.35, pointRadius: 0 }
      ]
    },
    options: {
      ...chartDefaults(),
      animation: { duration: 800 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        ...chartDefaults().plugins,
        tooltip: {
          ...chartDefaults().plugins.tooltip,
          callbacks: { label: context => `${context.dataset.label}: ${fmtNum(context.parsed.y)}${context.label === (forecastStartDate || 'FORECAST START') ? ' (Forecast)' : ''}` }
        },
        title: {
          display: true,
          text: `${(document.getElementById('forecastProduct')?.selectedOptions?.[0]?.text || 'Demand').replace(/-/g, ' ')}`,
          color: '#1f2937',
          font: { size: 13, weight: '700' }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Date', color: '#475569', font: { weight: '600' } },
          ticks: { color: '#64748b' },
          grid: { color: 'rgba(148,163,184,0.12)' }
        },
        y: {
          title: { display: true, text: 'Demand / Units', color: '#475569', font: { weight: '600' } },
          ticks: { color: '#64748b' },
          grid: { color: 'rgba(148,163,184,0.12)' }
        }
      }
    }
  });
}

/* ================================================================
   INVENTORY INTELLIGENCE (ALERTS PAGE)
   ================================================================ */
async function initAlertsPage() {
  try {
    const data = await apiFetch(`${API}/intelligence/products`);
    const products = data.products || [];

    renderAlertCards(products);
    buildAlertsChart(products);
    renderAlertsTable(products);
  } catch (err) {
    console.error('Alerts page error:', err);
    showToast('Failed to load inventory data');
    const tbody = document.getElementById('alertsTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626;padding:16px">Error loading data: ${err.message}</td></tr>`;
  }
}

function renderAlertCards(products) {
  const container = document.getElementById('alertCards');
  if (!container) return;
  const critical = products.filter(p => (p.risk_level || '').toLowerCase() === 'critical');
  const high = products.filter(p => (p.risk_level || '').toLowerCase() === 'high');
  const overstock = products.filter(p => (p.risk_level || '').toLowerCase() === 'low' && p.inventory > p.predicted_demand * 1.5);
  container.innerHTML = `
    <div class="alert-card critical">
      <i class="fa-solid fa-circle-exclamation alert-icon"></i>
      <div>
        <div class="alert-title">${critical.length} Critical Stockout Risks</div>
        <div class="alert-desc">${critical.map(p => p.name || p.id).join(', ') || 'None'}</div>
      </div>
    </div>
    <div class="alert-card warning">
      <i class="fa-solid fa-triangle-exclamation alert-icon"></i>
      <div>
        <div class="alert-title">${high.length} High Risk Products</div>
        <div class="alert-desc">${high.map(p => p.name || p.id).join(', ') || 'None'}</div>
      </div>
    </div>
    <div class="alert-card info">
      <i class="fa-solid fa-circle-info alert-icon"></i>
      <div>
        <div class="alert-title">Overstock Candidates</div>
        <div class="alert-desc">${overstock.length} product(s) may have excess inventory</div>
      </div>
    </div>`;
}

function buildAlertsChart(products) {
  destroyChart('alertsChart');
  const ctx = document.getElementById('alertsChart');
  if (!ctx || !products.length) return;
  charts['alertsChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: products.map(p => p.name || p.id),
      datasets: [
        { label: 'Current Inventory', data: products.map(p => p.inventory || 0), backgroundColor: 'rgba(37,99,235,0.65)', borderRadius: 6 },
        { label: 'Predicted Demand', data: products.map(p => p.predicted_demand || 0), backgroundColor: 'rgba(220,38,38,0.6)', borderRadius: 6 }
      ]
    },
    options: { ...chartDefaults() }
  });
}

function renderAlertsTable(products) {
  const tbody = document.getElementById('alertsTableBody');
  if (!tbody) return;
  tbody.innerHTML = products.map(p => {
    const covDays = p.inventory && p.predicted_demand ? ((p.inventory / (p.predicted_demand / 30)) || 0).toFixed(1) : '—';
    const sp = Math.round(p.stockout_probability || 0); // already 0-100
    return `<tr>
      <td><strong>${p.name || p.id}</strong></td>
      <td>${p.category || '—'}</td>
      <td>${fmtNum(p.inventory)}</td>
      <td>${fmtNum(p.predicted_demand)}</td>
      <td>${covDays}</td>
      <td style="color:${sp > 70 ? '#dc2626' : sp > 40 ? '#d97706' : '#059669'};font-weight:700">${sp}%</td>
      <td style="font-size:0.78rem">${p.recommended_action || '—'}</td>
      <td>${riskBadge(p.risk_level)}</td>
    </tr>`;
  }).join('');
}

/* ================================================================
   ACTION CENTER
   ================================================================ */
let _actionProducts = [];
let _actionFilter = 'all';

async function initActionCenter() {
  const container = document.getElementById('actionCardsList');
  if (container) container.innerHTML = '<div class="skeleton" style="height:160px;border-radius:12px;margin-bottom:12px"></div><div class="skeleton" style="height:160px;border-radius:12px;margin-bottom:12px"></div>';

  try {
    const data = await apiFetch(`${API}/intelligence/products`);
    _actionProducts = data.products || [];

    const countEl = document.getElementById('actionCenterCount');
    if (countEl) countEl.textContent = `${_actionProducts.length} Active Recommendations`;

    const badge = document.getElementById('actionBadge');
    const critCount = _actionProducts.filter(p => ['critical', 'high'].includes((p.risk_level || '').toLowerCase())).length;
    if (badge) { badge.textContent = critCount; badge.style.display = critCount > 0 ? '' : 'none'; }

    renderActionCards();
    loadRecentDecisions();
  } catch (err) {
    if (container) container.innerHTML = `<div class="validation-msg error" style="display:block">Failed to load recommendations: ${err.message}</div>`;
    showToast('Could not load action center data');
  }
}

function renderActionCards() {
  const container = document.getElementById('actionCardsList');
  if (!container) return;
  const filtered = _actionFilter === 'all'
    ? _actionProducts
    : _actionProducts.filter(p => (p.risk_level || '').toLowerCase() === _actionFilter);

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-check"></i><h3>No recommendations</h3><p>No products match this filter</p></div>';
    return;
  }

  container.innerHTML = filtered.map(p => {
    const sp = Math.round(p.stockout_probability || 0); // already 0-100
    const rl = (p.risk_level || 'low').toLowerCase();
    const persistedStatus = p.current_action?.status?.toLowerCase();
    const statusHtml = persistedStatus
      ? `<span style="font-size:0.82rem;font-weight:700;color:var(--text-muted)">${persistedStatus}</span>`
      : `<button class="btn-approve" onclick="submitAction('${p.id}','${(p.name || p.id).replace(/'/g, "\\'")}','${p.recommended_action || 'Review'}','approved')"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn-reject" onclick="submitAction('${p.id}','${(p.name || p.id).replace(/'/g, "\\'")}','${p.recommended_action || 'Review'}','rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>
        <button class="btn-snooze" onclick="submitAction('${p.id}','${(p.name || p.id).replace(/'/g, "\\'")}','${p.recommended_action || 'Review'}','snoozed')"><i class="fa-solid fa-clock"></i> Snooze</button>`;
    return `<div class="action-card ${rl}" id="acard-${p.id}">
      <div class="action-card-header">
        <div>
          <div class="action-card-title">${p.name || p.id}</div>
          <div class="action-card-meta">${p.category || '—'} &nbsp;·&nbsp; ${riskBadge(p.risk_level)}</div>
        </div>
        <span style="font-size:0.75rem;color:var(--text-muted)">${fmtCurrency(p.revenue_at_risk)} at risk</span>
      </div>
      <div class="action-card-metrics">
        <div class="action-metric">
          <div class="action-metric-label">Stockout Probability</div>
          <div class="action-metric-value" style="color:${sp > 70 ? '#dc2626' : sp > 40 ? '#d97706' : '#059669'}">${sp}%</div>
        </div>
        <div class="action-metric">
          <div class="action-metric-label">Predicted Demand</div>
          <div class="action-metric-value">${fmtNum(p.predicted_demand)}</div>
        </div>
        <div class="action-metric">
          <div class="action-metric-label">Current Inventory</div>
          <div class="action-metric-value">${fmtNum(p.inventory)}</div>
        </div>
      </div>
      <div style="font-size:0.81rem;color:var(--text);font-weight:600;margin-bottom:10px;padding:8px 10px;background:var(--surface2);border-radius:6px">
        <i class="fa-solid fa-lightbulb" style="color:#d97706"></i>
        ${p.recommended_action || 'Review inventory levels'}
      </div>
      <div class="action-btns">
        ${statusHtml}
        <button class="btn-explain" onclick="showProductDetail('${p.id}')">
          <i class="fa-solid fa-magnifying-glass-chart"></i> Explain
        </button>
      </div>
    </div>`;
  }).join('');
}

async function submitAction(productId, productName, recommendation, decision) {
  const reason = decision === 'rejected' ? window.prompt('Rejection reason:')?.trim() : '';
  if (decision === 'rejected' && !reason) return showToast('A rejection reason is required.');
  try {
    await apiFetch(`${API}/intelligence/action`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, product_name: productName, recommendation, action: recommendation, decision, reason })
    });
    const card = document.getElementById(`acard-${productId}`);
    if (card) {
      card.style.opacity = '0.4';
      card.style.pointerEvents = 'none';
      const d = { approved: '✓ Approved', rejected: '✗ Rejected', snoozed: '⏰ Snoozed' }[decision] || decision;
      card.querySelector('.action-btns').innerHTML = `<span style="font-size:0.82rem;font-weight:700;color:var(--text-muted)">${d}</span>`;
    }
    showToast(`${decision.charAt(0).toUpperCase() + decision.slice(1)}: ${productName}`);
    loadRecentDecisions();
  } catch (err) {
    showToast(`Failed to record decision: ${err.message}`);
  }
}

async function loadRecentDecisions() {
  try {
    const data = await apiFetch(`${API}/intelligence/audit`);
    const entries = (data.entries || []).slice(0, 5);
    const tbody = document.getElementById('recentDecisionsBody');
    if (!tbody) return;
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:16px">No decisions recorded yet</td></tr>';
      return;
    }
    tbody.innerHTML = entries.map(e => {
      const d = (e.status || 'pending').toLowerCase();
      const cls = { approved: 'audit-approved', rejected: 'audit-rejected', snoozed: 'audit-snoozed', pending: 'audit-pending' }[d] || 'audit-pending';
      return `<tr>
        <td style="font-size:0.75rem;color:var(--text-muted)">${new Date(e.timestamp).toLocaleString()}</td>
        <td>${e.product_name || e.product_id}</td>
        <td style="font-size:0.78rem">${e.recommendation || e.action || '—'}</td>
        <td><span class="audit-status ${cls}">${d}</span></td>
        <td style="font-size:0.75rem">${e.user_name || 'System'}</td>
      </tr>`;
    }).join('');
  } catch (_) { /* silent fail */ }
}

/* ================================================================
   SCENARIO LAB
   ================================================================ */
function initScenarioLab() {
  // Sliders wire-up
  const sliders = [
    ['scDemandA', 'scDemandAVal', v => (v >= 0 ? '+' : '') + v + '%'],
    ['scPriceA', 'scPriceAVal', v => (v >= 0 ? '+' : '') + v + '%'],
    ['scInventoryA', 'scInventoryAVal', v => (v >= 0 ? '+' : '') + v + '%'],
    ['scLeadA', 'scLeadAVal', v => v + 'd'],
    ['scDemandB', 'scDemandBVal', v => (v >= 0 ? '+' : '') + v + '%'],
    ['scPriceB', 'scPriceBVal', v => (v >= 0 ? '+' : '') + v + '%'],
    ['scInventoryB', 'scInventoryBVal', v => (v >= 0 ? '+' : '') + v + '%'],
    ['scLeadB', 'scLeadBVal', v => v + 'd'],
  ];
  sliders.forEach(([id, valId, fmt]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeEventListener('input', el._scHandler);
    el._scHandler = function () { const vEl = document.getElementById(valId); if (vEl) vEl.textContent = fmt(Number(this.value)); };
    el.addEventListener('input', el._scHandler);
  });
  const productSelect = document.getElementById('scenarioProduct');
  if (productSelect && !productSelect._productsLoaded) {
    productSelect._productsLoaded = true;
    const datasetSelect = document.getElementById('scenarioDataset');
    const loadProducts = () => {
      const datasetId = datasetSelect?.value;
      const endpoint = datasetId && datasetId !== 'default'
        ? `${API}/intelligence/datasets/${encodeURIComponent(datasetId)}`
        : `${API}/intelligence/products`;
      return apiFetch(endpoint).then(data => {
        const products = data.products || data.dataset?.rows || [];
        const catalogue = data.products ? products : hydrateForecastProductCatalogFromRows(products);
        productSelect.innerHTML = catalogue.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join('');
        if (!catalogue.length) productSelect.innerHTML = '<option value="">No products available</option>';
        const selected = catalogue.find(product => product.id === productSelect.value) || catalogue[0];
        const leadTime = Number(selected?.lead_time);
        const leadInput = document.getElementById('scLeadA');
        if (leadInput && Number.isFinite(leadTime)) {
          leadInput.value = Math.max(Number(leadInput.min), Math.min(Number(leadInput.max), leadTime));
          leadInput.dispatchEvent(new Event('input'));
        }
        productSelect._scenarioProducts = catalogue;
      });
    };
    const loadDataset = () => apiFetch(`${API}/intelligence/datasets`).then(data => {
      if (!datasetSelect) return loadProducts();
      const options = [{ id: 'default', name: 'Default dataset' }, ...(data.datasets || []).map(dataset => ({ id: dataset.id, name: dataset.name || 'Dataset' }))];
      const current = uploadedDatasetId || 'default';
      datasetSelect.innerHTML = options.map(option => `<option value="${option.id}">${escapeHtml(option.name)}</option>`).join('');
      datasetSelect.value = options.some(option => option.id === current) ? current : 'default';
      return loadProducts();
    });
    loadDataset().then(() => {
      productSelect.addEventListener('change', () => {
        const product = productSelect._scenarioProducts?.find(item => item.id === productSelect.value);
        const value = Number(product?.lead_time);
        const leadInput = document.getElementById('scLeadA');
        const forecastProduct = document.getElementById('forecastProduct');
        if (forecastProduct && [...forecastProduct.options].some(option => option.value === productSelect.value)) forecastProduct.value = productSelect.value;
        if (leadInput && Number.isFinite(value)) {
          leadInput.value = Math.max(Number(leadInput.min), Math.min(Number(leadInput.max), value));
          leadInput.dispatchEvent(new Event('input'));
        }
      });
      datasetSelect?.addEventListener('change', () => {
        uploadedDatasetId = datasetSelect.value === 'default' ? null : datasetSelect.value;
        if (uploadedDatasetId) localStorage.setItem('forecastai_dataset_id', uploadedDatasetId);
        const forecastDataset = document.getElementById('forecastDataset');
        if (forecastDataset && [...forecastDataset.options].some(option => option.value === datasetSelect.value)) forecastDataset.value = datasetSelect.value;
        loadProducts().catch(error => { productSelect.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`; });
      });
    }).catch(error => { productSelect.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`; });
  }
}

async function runScenarioSimulation() {
  const productId = document.getElementById('scenarioProduct')?.value;
  if (!productId) return showToast('Select an available product first.');
  const getVal = id => Number(document.getElementById(id)?.value || 0);

  const scenarios = [
    {
      id: 'scenario-a',
      name: 'Scenario A',
      sales_change_pct: getVal('scDemandA'),
      price_change_pct: getVal('scPriceA'),
      inventory_change_pct: getVal('scInventoryA'),
      lead_time_value: getVal('scLeadA')
    },
    {
      id: 'scenario-b',
      name: 'Scenario B',
      sales_change_pct: getVal('scDemandB'),
      price_change_pct: getVal('scPriceB'),
      inventory_change_pct: getVal('scInventoryB'),
      lead_time_value: getVal('scLeadB')
    }
  ];

  const button = document.getElementById('runScenarioBtn');
  if (button) button.disabled = true;
  const container = document.getElementById('scenarioResults');
  if (container) container.innerHTML = '<div class="validation-msg info" style="display:block">Running scenario simulation...</div>';
  try {
    const data = await apiFetch(`${API}/intelligence/scenario`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, datasetId: document.getElementById('scenarioDataset')?.value !== 'default' ? document.getElementById('scenarioDataset')?.value : undefined, scenarios })
    });
    renderScenarioResults(data);
    _lastScenarioResult = { productId, input: scenarios, result: data };
    showToast('Scenario simulation complete');
  } catch (err) {
    if (container) container.innerHTML = `<div class="validation-msg error" style="display:block">Scenario simulation failed: ${escapeHtml(err.message)} <button class="glass-btn" onclick="runScenarioSimulation()">Retry</button></div>`;
    showToast('Scenario simulation failed');
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveCurrentScenario() {
  if (!_lastScenarioResult) return showToast('Run a simulation before saving it.');
  const name = window.prompt('Scenario name:', 'Inventory scenario');
  if (!name) return;
  await apiFetch(`${API}/intelligence/scenarios`, {
    method: 'POST',
    body: JSON.stringify({ name, productId: _lastScenarioResult.productId, input: _lastScenarioResult.input, result: _lastScenarioResult.result })
  });
  showToast('Scenario saved');
  loadSavedScenarios();
}

async function loadSavedScenarios() {
  const container = document.getElementById('savedScenariosList');
  if (!container) return;
  try {
    const { scenarios = [] } = await apiFetch(`${API}/intelligence/scenarios`);
    container.innerHTML = scenarios.length ? scenarios.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.72rem;padding:6px 0;border-bottom:1px solid var(--border)"><span>${escapeHtml(s.name)}<br><small>${new Date(s.createdAt).toLocaleString()}</small></span><button class="icon-btn" title="Delete saved scenario" onclick="deleteSavedScenario('${s.id}')"><i class="fa-solid fa-trash"></i></button></div>`).join('') : '<span style="font-size:.72rem;color:var(--text-muted)">No saved scenarios</span>';
  } catch (err) { container.textContent = `Unable to load saved scenarios: ${err.message}`; }
}

async function deleteSavedScenario(id) {
  if (!window.confirm('Delete this saved scenario?')) return;
  await apiFetch(`${API}/intelligence/scenarios/${id}`, { method: 'DELETE' });
  loadSavedScenarios();
}

function renderScenarioResults(data) {
  const container = document.getElementById('scenarioResults');
  const chartCard = document.getElementById('scenarioChartCard');
  if (!container) return;

  const { baseline, scenarios } = data;
  const all = [{ scenario_id: 'baseline', scenario_name: 'Baseline', ...baseline, demand_delta: 0, demand_delta_pct: 0 }, ...scenarios];

  container.innerHTML = all.map(s => {
    const isBase = s.scenario_id === 'baseline';
    const deltaHtml = !isBase && s.demand_delta_pct != null
      ? `<div class="scenario-metric"><span class="scenario-metric-label">Demand Delta</span><span class="scenario-metric-val ${s.demand_delta >= 0 ? 'delta-positive' : 'delta-negative'}">${s.demand_delta >= 0 ? '+' : ''}${Number(s.demand_delta_pct).toFixed(1)}%</span></div>`
      : '';
    return `<div class="scenario-result-card ${isBase ? 'baseline' : ''}">
      <div class="scenario-name">${isBase ? '📊 ' : '🔬 '}${s.scenario_name || s.scenario_id}</div>
      <div class="scenario-metrics">
        <div class="scenario-metric"><span class="scenario-metric-label">Demand</span><span class="scenario-metric-val">${fmtNum(s.predicted_demand)}</span></div>
        <div class="scenario-metric"><span class="scenario-metric-label">Inventory</span><span class="scenario-metric-val">${fmtNum(s.inventory)}</span></div>
        <div class="scenario-metric"><span class="scenario-metric-label">Stockout Risk</span><span class="scenario-metric-val">${fmtPct(s.stockout_probability || 0)}</span></div>
        <div class="scenario-metric"><span class="scenario-metric-label">Overstock Risk</span><span class="scenario-metric-val">${fmtPct(s.overstock_probability || 0)}</span></div>
        <div class="scenario-metric"><span class="scenario-metric-label">Revenue</span><span class="scenario-metric-val">${fmtCurrency(s.expected_revenue ?? s.expected_value ?? 0)}</span></div>
        <div class="scenario-metric"><span class="scenario-metric-label">Recommended Order</span><span class="scenario-metric-val">${fmtNum(s.recommended_order_qty ?? 0)}</span></div>
        <div class="scenario-metric"><span class="scenario-metric-label">Decision</span><span class="scenario-metric-val">${escapeHtml(s.recommended_action || '—')}</span></div>
        <div class="scenario-metric"><span class="scenario-metric-label">Coverage Days</span><span class="scenario-metric-val">${s.inventory_coverage_days ?? '—'}</span></div>
        ${deltaHtml}
        ${!isBase ? `<div class="scenario-metric"><span class="scenario-metric-label">Risk Level</span><span class="scenario-metric-val">${riskBadge(s.risk_level)}</span></div>` : ''}
      </div>
    </div>`;
  }).join('');

  container.insertAdjacentHTML('afterbegin', `<div class="validation-msg info" style="display:block;margin-bottom:10px">Model: ${escapeHtml(data.model || activeModel)} · ${escapeHtml(data.methodology || 'Baseline ML forecast plus scenario adjustment.')}</div>`);

  if (chartCard) chartCard.style.display = '';
  buildScenarioChart(all);
}

function buildScenarioChart(scenarios) {
  destroyChart('scenarioChart');
  const ctx = document.getElementById('scenarioChart');
  if (!ctx) return;
  charts['scenarioChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: scenarios.map(s => s.scenario_name || s.scenario_id),
      datasets: [
        { label: 'Predicted Demand', data: scenarios.map(s => s.predicted_demand || 0), backgroundColor: ['rgba(37,99,235,0.7)', 'rgba(5,150,105,0.7)', 'rgba(217,119,6,0.7)'].slice(0, scenarios.length), borderRadius: 8 },
        { label: 'Recommended Stock', data: scenarios.map(s => s.recommended_stock || 0), backgroundColor: ['rgba(37,99,235,0.3)', 'rgba(5,150,105,0.3)', 'rgba(217,119,6,0.3)'].slice(0, scenarios.length), borderRadius: 8 }
      ]
    },
    options: { ...chartDefaults(), animation: { duration: 900 } }
  });
}

/* ================================================================
   COPILOT
   ================================================================ */
let _copilotInited = false;

function initCopilot() {
  if (_copilotInited) return;
  _copilotInited = true;
  const input = document.getElementById('copilotInput');
  const sendBtn = document.getElementById('copilotSend');
  if (input) {
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCopilotMessage(); } });
  }
  if (sendBtn) sendBtn.addEventListener('click', sendCopilotMessage);
  const clearBtn = document.getElementById('clearCopilot');
  if (clearBtn) clearBtn.addEventListener('click', clearCopilotChat);
}

function copilotSuggest(el) {
  const input = document.getElementById('copilotInput');
  if (input) { input.value = el.textContent.trim(); input.focus(); }
  sendCopilotMessage();
}

async function sendCopilotMessage() {
  const input = document.getElementById('copilotInput');
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;
  input.value = '';

  appendChatMsg('user', query);
  const typingId = appendTypingIndicator();

  try {
    const data = await apiFetch(`${API}/intelligence/copilot`, {
      method: 'POST',
      body: JSON.stringify({ query })
    });
    removeTypingIndicator(typingId);
    appendBotMessage(data.answer || 'I could not generate an answer.', data.cards || [], data.links || []);
  } catch (err) {
    removeTypingIndicator(typingId);
    appendBotMessage(`Sorry, I encountered an error: ${err.message}. Please check the backend connection.`, [], []);
  }
}

function appendChatMsg(role, text) {
  const container = document.getElementById('copilot-messages');
  if (!container) return;
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `
    <div class="chat-avatar ${role}">${isUser ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-chart-line"></i>'}</div>
    <div><div class="chat-bubble">${escapeHtml(text)}</div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendBotMessage(text, cards, links) {
  const container = document.getElementById('copilot-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'chat-msg bot';

  let cardsHtml = '';
  if (cards && cards.length) {
    cardsHtml = '<div class="chat-cards">' + cards.map(c => `
      <div class="chat-card">
        <div class="chat-card-title">${c.title || c.name || ''}</div>
        ${Object.entries(c).filter(([k]) => !['title', 'name'].includes(k)).slice(0, 4).map(([k, v]) => `
          <div class="chat-card-row"><span>${k.replace(/_/g, ' ')}</span><strong>${v}</strong></div>`).join('')}
      </div>`).join('') + '</div>';
  }
  let linksHtml = '';
  if (links && links.length) {
    linksHtml = '<div class="chat-links">' + links.map(l => `<button class="chat-link-btn" onclick="navigateTo('${l.page}')">${l.label}</button>`).join('') + '</div>';
  }
  div.innerHTML = `
    <div class="chat-avatar bot"><i class="fa-solid fa-chart-line"></i></div>
    <div>
      <div class="chat-bubble">${text.replace(/\n/g, '<br>')}${cardsHtml}${linksHtml}</div>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTypingIndicator() {
  const container = document.getElementById('copilot-messages');
  if (!container) return null;
  const id = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'chat-msg bot'; div.id = id;
  div.innerHTML = `<div class="chat-avatar bot"><i class="fa-solid fa-chart-line"></i></div><div><div class="chat-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

function clearCopilotChat() {
  const container = document.getElementById('copilot-messages');
  if (!container) return;
  container.innerHTML = `<div class="chat-msg bot">
    <div class="chat-avatar bot"><i class="fa-solid fa-chart-line"></i></div>
    <div><div class="chat-bubble">Chat cleared. How can I help you?</div></div>
  </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ================================================================
   MODEL LAB
   ================================================================ */
async function initModelLab() {
  const tbody = document.getElementById('modelTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10"><div class="skeleton" style="height:40px;border-radius:4px"></div></td></tr>';

  try {
    const datasetId = uploadedDatasetId || document.getElementById('mlDatasetSelect')?.value;
    const data = await apiFetch(`${API}/intelligence/models${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`);
    activeModel = data.active_model || activeModel;
    localStorage.setItem('forecastai_active_model', activeModel);
    setEl('activeModelLabel', `${activeModel} · recommended: ${data.best_model || '—'}`);
    const recommended = data.best_model;
    document.getElementById('useRecommendedModelBtn')?.setAttribute('data-model', recommended || '');
    const { models, best_model, feature_importance, split_info } = data;
    renderModelTable(models || [], best_model);
    renderFeatureImportance(feature_importance || {});
    renderSplitInfo(split_info || {});
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="color:#dc2626;padding:16px">Failed to load model data: ${err.message}</td></tr>`;
    showToast('Could not load model data');
  }
}

async function useRecommendedModel() {
  const model = document.getElementById('useRecommendedModelBtn')?.dataset.model;
  if (!model) return showToast('No recommended model is available.');
  try {
    const response = await apiFetch(`${API}/intelligence/models/active`, { method: 'POST', body: JSON.stringify({ model, datasetId: uploadedDatasetId || undefined }) });
    activeModel = response.active_model;
    localStorage.setItem('forecastai_active_model', activeModel);
    setEl('activeModelLabel', `${activeModel} is now active.`);
    showToast(`${activeModel} is now the active forecasting model.`);
  } catch (error) { showToast(`Could not activate model: ${error.message}`); }
}

function renderModelTable(models, bestModel) {
  const tbody = document.getElementById('modelTableBody');
  if (!tbody) return;
  if (!models.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-muted)">No model data available</td></tr>';
    return;
  }
  tbody.innerHTML = models.map(m => {
    const isBest = m.is_best || m.model === bestModel;
    const r2Cls = m.r2 > 0.9 ? 'metric-good' : m.r2 > 0.7 ? 'metric-warn' : 'metric-bad';
    const mapeCls = m.mape < 10 ? 'metric-good' : m.mape < 20 ? 'metric-warn' : 'metric-bad';
    return `<tr class="model-row ${isBest ? 'best-model' : ''}">
      <td>${m.model || '—'}${isBest ? '<span class="best-badge">BEST</span>' : ''}</td>
      <td>${Number(m.mae || 0).toFixed(1)}</td>
      <td>${Number(m.rmse || 0).toFixed(1)}</td>
      <td class="${mapeCls}">${Number(m.mape || 0).toFixed(1)}%</td>
      <td class="${r2Cls}">${Number(m.r2 || 0).toFixed(4)}</td>
      <td>${Number(m.bias || 0).toFixed(2)}</td>
      <td>${m.train_samples || '—'}</td>
      <td>${m.test_samples || '—'}</td>
      <td>${Number(m.training_time_s || 0).toFixed(2)}</td>
      <td><span class="status-badge ${m.status === 'active' ? 'status-ok' : 'status-warning'}">${m.status || '—'}</span></td>
    </tr>`;
  }).join('');
}

function renderFeatureImportance(fi) {
  const container = document.getElementById('featureImportanceBars');
  if (!container) return;
  // fi can be array [{feature, importance}] or object {feature: importance}
  let entries;
  if (Array.isArray(fi)) {
    entries = fi.map(item => [item.feature, item.importance]).sort((a, b) => b[1] - a[1]);
  } else {
    entries = Object.entries(fi || {}).sort((a, b) => b[1] - a[1]);
  }
  if (!entries.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px"><i class="fa-solid fa-chart-bar"></i><h3>No data</h3></div>';
    return;
  }
  const max = entries[0][1] || 1;
  container.innerHTML = entries.map(([feat, val]) => {
    const pct = Math.min(100, (val / max) * 100);
    return `<div class="fi-bar-wrap">
      <span class="fi-label">${feat.replace(/_/g, ' ')}</span>
      <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
        <div class="fi-bar" style="width:${pct}%"></div>
      </div>
      <span class="fi-value">${(val * 100).toFixed(1)}%</span>
    </div>`;
  }).join('');
}

function renderSplitInfo(split) {
  const container = document.getElementById('splitInfoCard');
  if (!container) return;
  if (!Object.keys(split).length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;padding:12px">No split info available</p>';
    return;
  }
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:4px 0">
      ${Object.entries(split).map(([k, v]) => `
        <div class="ml-metric"><span class="ml-metric-label">${k.replace(/_/g, ' ')}</span><span class="ml-metric-val" style="font-size:0.88rem">${v}</span></div>
      `).join('')}
    </div>
    <p style="font-size:0.75rem;color:var(--text-muted);margin-top:12px;line-height:1.6">
      The dataset is split chronologically. Training data teaches the model historical patterns, and the test set validates real-world forecasting accuracy on unseen future data.
    </p>`;
}

/* ================================================================
   DATA QUALITY
   ================================================================ */
async function initDataQuality() {
  // Just sets up file handler, actual run triggered by button
  const dqFile = document.getElementById('dqFileInput');
  if (dqFile && !dqFile._bound) {
    dqFile._bound = true;
    dqFile.addEventListener('change', () => {
      const file = dqFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        const parsed = parseCSV(e.target.result);
        if (parsed) { dqUploadedRows = parsed.rows; showToast(`Loaded "${file.name}" — ${parsed.rows.length} rows`); }
        else showToast('Could not parse CSV file');
      };
      reader.readAsText(file);
    });
  }
}

async function runDataQuality() {
  document.getElementById('loadingOverlay').classList.add('show');
  try {
    const body = dqUploadedRows ? { rows: dqUploadedRows } : {};
    const data = await apiFetch(`${API}/data-quality`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    hideLoading();
    renderDataQualityResults(data);
  } catch (err) {
    hideLoading();
    showToast(`Quality check failed: ${err.message}`);
    const list = document.getElementById('dqIssuesList');
    if (list) list.innerHTML = `<div class="validation-msg error" style="display:block">Error: ${err.message}</div>`;
  }
}

function renderDataQualityResults(data) {
  const { score, rows, column_count, columns: columnList, issues, summary } = data;

  /* Score ring */
  const ring = document.getElementById('dqScoreRing');
  const val = document.getElementById('dqScoreVal');
  const rows_ = document.getElementById('dqRowsInfo');
  const cols_ = document.getElementById('dqColsInfo');
  if (val) val.textContent = Math.round(score || 0);
  if (rows_) rows_.textContent = `${rows || 0} rows`;
  if (cols_) cols_.textContent = `${column_count || 0} columns${columnList?.length ? ': ' + columnList.join(', ') : ''}`;
  if (ring) {
    ring.className = 'quality-score-ring ' + (score >= 80 ? 'quality-good' : score >= 60 ? 'quality-warn' : 'quality-bad');
  }

  /* Summary cards */
  const s = summary || {};
  setEl('dqMissing', s.missing_values ?? '—');
  setEl('dqDuplicates', s.duplicates ?? '—');
  setEl('dqOutliers', s.outliers ?? '—');

  /* Issues list */
  const list = document.getElementById('dqIssuesList');
  if (!list) return;
  const issueArr = issues || [];
  if (!issueArr.length) {
    list.innerHTML = '<div class="empty-state" style="padding:20px"><i class="fa-solid fa-circle-check" style="color:#059669"></i><h3>No issues found</h3><p>Your dataset looks clean!</p></div>';
    return;
  }
  list.innerHTML = issueArr.map(issue => {
    const sev = (issue.severity || 'low').toLowerCase();
    const sevCls = { critical: 'sev-critical', high: 'sev-high', medium: 'sev-medium', low: 'sev-low' }[sev] || 'sev-low';
    const icons = { missing: 'circle-minus', duplicate: 'copy', outlier: 'chart-bar', schema: 'table' };
    const icon = icons[issue.type] || 'exclamation-circle';
    return `<div class="issue-item">
      <span class="issue-severity ${sevCls}">${sev}</span>
      <i class="fa-solid fa-${icon}" style="color:var(--text-muted);margin-top:2px"></i>
      <div>
        <div style="font-size:0.81rem;font-weight:700;color:var(--text)">${issue.column ? `[${issue.column}] ` : ''}${issue.type || 'Issue'}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">${issue.message || ''}${issue.count ? ` (${issue.count} occurrences)` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

/* ================================================================
   AUDIT LOG
   ================================================================ */
let _auditEntries = [];
let _auditFilter = 'all';
let _auditPage = 0;
const AUDIT_PER_PAGE = 15;

async function initAudit() {
  const tbody = document.getElementById('auditTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="skeleton" style="height:36px;border-radius:4px"></div></td></tr>';

  try {
    const data = await apiFetch(`${API}/intelligence/audit`);
    _auditEntries = data.entries || [];
    _auditPage = 0;
    renderAuditTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626;padding:16px">Failed to load audit log: ${err.message}</td></tr>`;
    showToast('Could not load audit log');
  }
}

function renderAuditTable() {
  const tbody = document.getElementById('auditTableBody');
  const pagination = document.getElementById('auditPagination');
  const countEl = document.getElementById('auditCount');
  if (!tbody) return;

  const filtered = _auditFilter === 'all'
    ? _auditEntries
    : _auditEntries.filter(e => (e.status || '').toLowerCase() === _auditFilter);

  if (countEl) countEl.textContent = `${filtered.length} entries`;

  const start = _auditPage * AUDIT_PER_PAGE;
  const page = filtered.slice(start, start + AUDIT_PER_PAGE);

  if (!page.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">No entries match this filter</td></tr>';
    if (pagination) pagination.innerHTML = '';
    return;
  }

  tbody.innerHTML = page.map(e => {
    const d = (e.status || 'pending').toLowerCase();
    const sc = { approved: 'audit-approved', rejected: 'audit-rejected', snoozed: 'audit-snoozed', pending: 'audit-pending' }[d] || 'audit-pending';
    return `<tr>
      <td style="font-size:0.75rem;white-space:nowrap">${new Date(e.timestamp).toLocaleString()}</td>
      <td style="font-size:0.78rem">${e.user_name || 'System'}</td>
      <td><strong>${e.product_name || e.product_id || '—'}</strong></td>
      <td style="font-size:0.78rem">${e.action || e.recommendation || '—'}</td>
      <td><span class="audit-status ${sc}">${d}</span></td>
      <td style="font-size:0.75rem">${e.model || '—'}</td>
      <td style="font-size:0.75rem">${e.confidence ? fmtPct(e.confidence) : '—'}</td>
      <td style="font-size:0.75rem;color:var(--text-muted)">${e.reason || '—'}</td>
    </tr>`;
  }).join('');

  /* Pagination */
  if (pagination) {
    const totalPages = Math.ceil(filtered.length / AUDIT_PER_PAGE);
    let html = '';
    for (let i = 0; i < totalPages; i++) {
      html += `<button class="page-btn ${i === _auditPage ? 'active' : ''}" onclick="_auditPage=${i};renderAuditTable()">${i + 1}</button>`;
    }
    html += `<span class="page-info">${start + 1}–${Math.min(start + AUDIT_PER_PAGE, filtered.length)} of ${filtered.length}</span>`;
    pagination.innerHTML = html;
  }
}

/* ================================================================
   ANALYTICS — driven by real data from uploaded CSV or backend
   ================================================================ */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];

/**
 * Build analytics charts. Uses uploadedCSVData if available, else fetches
 * live product data from the backend.
 */
async function buildAnalyticsCharts() {
  const opts = chartDefaults();
  const filterSel = document.getElementById('analyticsProduct');
  if (pendingSearchProduct && filterSel) {
    const option = [...filterSel.options].find(item => item.textContent.trim().toLowerCase() === pendingSearchProduct.toLowerCase());
    if (option) filterSel.value = option.value;
    pendingSearchProduct = null;
  }
  const selectedProduct = filterSel?.value && filterSel.value !== 'All Products' ? filterSel.value : '';
  const from = document.getElementById('dateFrom')?.value || '';
  const to = document.getElementById('dateTo')?.value || '';
  const region = document.getElementById('analyticsRegion')?.value || '';
  const granularity = document.getElementById('analyticsGranularity')?.value || 'monthly';
  if ((from && to && from > to)) return showToast('Invalid date range.');
  try {
    const query = new URLSearchParams({ product: selectedProduct, region, granularity });
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const resp = await apiFetch(`${API}/intelligence/analytics?${query}`);
    const rows = resp.rows || [];
    const setOptions = (element, values, allLabel) => {
      if (!element) return;
      const current = element.value;
      element.innerHTML = `<option value="">${allLabel}</option>${values.map(value => `<option value="${String(value).replace(/"/g, '&quot;')}">${value}</option>`).join('')}`;
      element.value = values.includes(current) ? current : '';
    };
    setOptions(filterSel, resp.products || [], 'All Products');
    const regionSel = document.getElementById('analyticsRegion');
    if (regionSel) {
      regionSel.disabled = !resp.hasRegion;
      setOptions(regionSel, resp.regions || [], 'All Regions');
      if (!resp.hasRegion) regionSel.title = 'This dataset has no region column.';
    }
    const fromInput = document.getElementById('dateFrom');
    const toInput = document.getElementById('dateTo');
    if (fromInput && resp.availableStart) { fromInput.min = resp.availableStart; fromInput.max = resp.availableEnd; fromInput.value = fromInput.value || resp.availableStart; }
    if (toInput && resp.availableEnd) { toInput.min = resp.availableStart; toInput.max = resp.availableEnd; toInput.value = toInput.value || resp.availableEnd; }
    if (!rows.length) {
      destroyChart('analyticsLine'); destroyChart('seasonal'); destroyChart('demandCompare');
      const empty = document.getElementById('heatmapContainer');
      if (empty) empty.innerHTML = '<div class="empty-state"><h3>No data available for the selected filters.</h3></div>';
      return;
    }
    let productData = {};
    let categories = {};
    rows.forEach(row => {
      const prod = row.product || 'Unknown';
      if (!productData[prod]) productData[prod] = { periods: {}, monthDemand: {}, category: row.category || 'Unknown' };
      productData[prod].periods[row.period] = Number(row.sales) || 0;
      productData[prod].monthDemand[row.month] = (productData[prod].monthDemand[row.month] || 0) + (Number(row.demand) || 0);
      const cat = row.category || 'Unknown';
      if (!categories[cat]) categories[cat] = { sales: 0, demand: 0 };
      categories[cat].sales += Number(row.sales) || 0;
      categories[cat].demand += Number(row.demand) || 0;
    });
    const products = Object.keys(productData).sort();
    const displayProducts = selectedProduct ? products.filter(product => product === selectedProduct) : products;
    const periods = [...new Set(rows.map(row => row.period))].sort();
    const hasUpload = false;

    // ── Chart 1: Product Demand Trends (monthly line chart) ──
    destroyChart('analyticsLine');
    const ctx1 = document.getElementById('analyticsLineChart');
    if (ctx1 && displayProducts.length) {
      const datasets = displayProducts.map((prod, i) => {
        const monthlyData = periods.map(period => productData[prod]?.periods[period] ?? null);
        return {
          label: prod,
          data: monthlyData,
          borderColor: CHART_COLORS[i % CHART_COLORS.length],
          backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18',
          tension: 0.4,
          pointRadius: 3,
          fill: false,
        };
      });

      charts['analyticsLine'] = new Chart(ctx1, {
        type: 'line',
        data: { labels: periods, datasets },
        options: {
          ...opts,
          plugins: {
            ...opts.plugins,
            title: {
              display: true,
              text: `Sales Trend — ${granularity === 'weekly' ? 'Weekly' : 'Monthly'}`,
              color: '#6b7280', font: { size: 11 }
            }
          }
        }
      });
    }

    // ── Chart 2: Seasonal / quarterly radar ──
    destroyChart('seasonal');
    const ctx2 = document.getElementById('seasonalChart');
    if (ctx2 && displayProducts.length) {
      const radarDatasets = displayProducts.map((prod, i) => {
        const ms = productData[prod].monthDemand || {};
        const q = [
          (ms[1] || 0) + (ms[2] || 0) + (ms[3] || 0),
          (ms[4] || 0) + (ms[5] || 0) + (ms[6] || 0),
          (ms[7] || 0) + (ms[8] || 0) + (ms[9] || 0),
          (ms[10] || 0) + (ms[11] || 0) + (ms[12] || 0),
        ];
        return {
          label: prod,
          data: q,
          borderColor: CHART_COLORS[i % CHART_COLORS.length],
          backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18',
          pointBackgroundColor: CHART_COLORS[i % CHART_COLORS.length],
        };
      });
      charts['seasonal'] = new Chart(ctx2, {
        type: 'radar',
        data: { labels: ['Q1', 'Q2', 'Q3', 'Q4'], datasets: radarDatasets },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#6b7280' } }, tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', cornerRadius: 8 } },
          scales: { r: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(0,0,0,0.07)' }, pointLabels: { color: '#6b7280' } } }
        }
      });
    }

    // ── Chart 3: Category Comparison (bar) ──
    destroyChart('demandCompare');
    const ctx3 = document.getElementById('demandCompareChart');
    if (ctx3 && Object.keys(categories).length) {
      const catLabels = Object.keys(categories).sort();
      charts['demandCompare'] = new Chart(ctx3, {
        type: 'bar',
        data: {
          labels: catLabels,
          datasets: [
            { label: 'Total Sales', data: catLabels.map(c => categories[c].sales), backgroundColor: 'rgba(37,99,235,0.55)', borderRadius: 8 },
            { label: 'Predicted Demand', data: catLabels.map(c => categories[c].demand), backgroundColor: 'rgba(5,150,105,0.65)', borderRadius: 8 },
          ]
        },
        options: opts
      });
    }

    buildHeatmap(displayProducts, productData, false);
  } catch (err) {
    console.warn('Analytics: backend fetch failed', err.message);
    const empty = document.getElementById('heatmapContainer');
    if (empty) empty.innerHTML = `<div class="empty-state"><h3>Unable to load analytics data.</h3><p>${err.message || 'Retry to refresh the analysis.'}</p></div>`;
  }
}

/**
 * Build correlation heatmap. Uses real product names from CSV or backend.
 * The correlation values are computed from actual data when available,
 * otherwise uses illustrative defaults.
 */
function buildHeatmap(productNames, productData, hasUpload) {
  const container = document.getElementById('heatmapContainer');
  if (!container) return;

  // Use real product names (up to 5)
  const prods = (productNames || ['Laptop Pro X1', 'Wireless Headphones', 'Smart Watch S3', 'Gaming Mouse']).slice(0, 5);
  const features = ['Price', 'Season', 'Inventory', 'Lead Time', 'Month'];

  // Compute rough "correlations" from data if available
  // For each product: [price_norm, inventory_norm, ...] vs sales
  let values;
  if (hasUpload && productData) {
    values = prods.map(prod => {
      const rows_p = uploadedCSVData.rows.filter(r => r.product === prod);
      if (!rows_p.length) return [0.5, 0.5, 0.5, 0.5, 0.5];
      // Simple correlation proxy: std / mean for each feature
      const corr = (field) => {
        const vals = rows_p.map(r => Number(r[field])).filter(v => !isNaN(v));
        if (!vals.length) return 0.5;
        const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
        // Normalise to 0–1 range
        return Math.min(1, Math.max(0, std / (mean || 1)));
      };
      const monthCor = corr('month');
      const invCor = corr('inventory');
      const priceCor = corr('price');
      const leadCor = corr('lead_time');
      const salesCor = corr('sales');
      return [
        Math.min(1, priceCor * 2),
        Math.min(1, monthCor * 3),
        Math.min(1, invCor * 2),
        Math.min(1, leadCor * 2),
        Math.min(1, salesCor * 2),
      ];
    });
  } else {
    container.innerHTML = '<div class="empty-state"><h3>No data available</h3><p>Upload or load a dataset to calculate correlations.</p></div>';
    return;
  }

  const colLabels = `<div class="heatmap-col-labels">${features.map(f => `<div class="heatmap-col-label">${f}</div>`).join('')}</div>`;
  const rowsHtml = prods.map((p, i) => {
    const rowVals = values[i] || [0.5, 0.5, 0.5, 0.5, 0.5];
    const cells = rowVals.map(v => {
      const r = Math.round(10 + (62 - 10) * v), g2 = Math.round(36 + (146 - 36) * v), b = Math.round(99 + (204 - 99) * v);
      return `<div class="heatmap-cell" style="background:rgba(${r},${g2},${b},0.85)" title="Feature variability: ${(v * 100).toFixed(0)}%">${v.toFixed(1)}</div>`;
    }).join('');
    // Shorten product name for display
    const shortName = p.replace('Pro X1', '').replace('Wireless ', '').replace('Smart ', '').replace('Gaming ', '').trim().slice(0, 8);
    return `<div class="heatmap-row"><span class="heatmap-label" title="${p}">${shortName}</span>${cells}</div>`;
  }).join('');

  container.innerHTML = colLabels + rowsHtml;
  if (hasUpload) {
    container.title = `Computed from uploaded dataset: ${uploadedFileName}`;
  }
}

/* ================================================================
   REPORTS TABLE
   ================================================================ */
function downloadTextFile(filename, text, type = 'text/plain') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function exportReportsCsv() {
  const response = await apiFetch(`${API}/intelligence/products`);
  const rows = (response.products || []).map(product => [product.name, product.category, product.sales, product.inventory, product.predicted_demand, product.stockout_probability, product.risk_level, product.recommended_action]);
  downloadTextFile('forecastai-current-risk.csv', [['Product', 'Category', 'Sales', 'Inventory', 'Predicted Demand', 'Stockout Probability', 'Risk Level', 'Recommended Action'], ...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
}

function exportReportsCharts() {
  const canvases = ['dashDemandChart', 'dashRiskPie', 'analyticsLineChart', 'seasonalChart', 'demandCompareChart'].map(id => document.getElementById(id)).filter(Boolean);
  const canvas = canvases.find(item => item.width > 0 && item.height > 0);
  if (!canvas) return showToast('No rendered chart available. Open a data page first.');
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = 'forecastai-chart.png';
  link.click();
}

function printReports() { window.print(); }

async function legacyViewReport(reportId) {
  const body = document.getElementById('explainModalBody');
  const title = document.getElementById('explainModalTitle');
  if (body) body.innerHTML = '<div class="report-loading"><div class="skeleton" style="height:28px;width:45%"></div><div class="skeleton" style="height:100px;margin-top:12px"></div><div class="skeleton" style="height:180px;margin-top:12px"></div></div>';
  if (title) title.innerHTML = '<i class="fa-solid fa-file-chart-column"></i> Loading report...';
  document.getElementById('explainModalOverlay')?.classList.add('show');
  try {
    const { report } = await apiFetch(`${API}/intelligence/reports/${encodeURIComponent(reportId)}`);
    const data = report.data || {};
    if (!body || !title) return;
    title.innerHTML = `<i class="fa-solid fa-file-chart-column"></i> ${escapeHtml(report.name)}`;
    const products = data.products || [];
    if (reportId === 'report-risk-current' && products.length) {
      const counts = products.reduce((all, item) => { const key = item.risk.risk_level || 'low'; all[key] = (all[key] || 0) + 1; return all; }, {});
      const totalInventory = products.reduce((sum, item) => sum + Number(item.inventory || 0), 0);
      const totalDemand = products.reduce((sum, item) => sum + Number(item.risk.predicted_demand || 0), 0);
      const totalStockout = products.reduce((sum, item) => sum + Number(item.risk.stockout_probability || 0), 0);
      const totalOverstock = products.reduce((sum, item) => sum + Number(item.risk.overstock_probability || 0), 0);
      const tableRows = products.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.category || '—')}</td><td>${fmtNum(item.risk.predicted_demand)}</td><td>${fmtNum(item.inventory)}</td><td>${item.risk.inventory_coverage_days ?? '—'}d</td><td>${item.risk.stockout_probability ?? '—'}%</td><td>${item.risk.overstock_probability ?? '—'}%</td><td>${riskBadge(item.risk.risk_level)}</td><td>${escapeHtml(item.risk.recommended_action || '—')}</td></tr>`).join('');
      const recommendations = products.filter(item => ['high', 'critical'].includes(item.risk.risk_level)).map(item => `<div class="report-recommendation"><strong>${escapeHtml(item.name)}</strong><span>${riskBadge(item.risk.risk_level)}</span><p>${escapeHtml(item.risk.action_reason || 'Risk detected from current forecast and inventory values.')}</p><b>Recommendation: ${escapeHtml(item.risk.recommended_action || 'MONITOR')}</b><small>Expected impact: ${item.risk.recommended_order_qty ? `restore approximately ${fmtNum(item.risk.recommended_order_qty)} units` : 'review inventory before the next order'}</small></div>`).join('') || '<div class="report-empty">No high-risk products in the active dataset.</div>';
      body.innerHTML = `<div class="report-shell"><div class="report-meta"><span>Generated <strong>${new Date(report.generatedAt).toLocaleString()}</strong></span><span>Dataset <strong>${escapeHtml(report.dataset)}</strong></span><span>Forecast period <strong>Current active period</strong></span></div><div class="report-summary-grid"><div class="report-summary-card"><small>Total Products</small><strong>${products.length}</strong></div><div class="report-summary-card"><small>High Risk</small><strong>${(counts.high || 0) + (counts.critical || 0)}</strong></div><div class="report-summary-card"><small>Medium Risk</small><strong>${counts.medium || 0}</strong></div><div class="report-summary-card"><small>Low Risk</small><strong>${counts.low || 0}</strong></div><div class="report-summary-card"><small>Total Inventory</small><strong>${fmtNum(totalInventory)}</strong></div><div class="report-summary-card"><small>Predicted Demand</small><strong>${fmtNum(totalDemand)}</strong></div><div class="report-summary-card"><small>Avg Stockout Risk</small><strong>${(totalStockout / products.length).toFixed(1)}%</strong></div><div class="report-summary-card"><small>Avg Overstock Risk</small><strong>${(totalOverstock / products.length).toFixed(1)}%</strong></div></div><div class="report-section"><h3>Risk Distribution</h3><div class="report-risk-bars"><span><b>Critical</b><i style="width:${((counts.critical || 0) / products.length) * 100}%" class="critical"></i><em>${counts.critical || 0}</em></span><span><b>High</b><i style="width:${((counts.high || 0) / products.length) * 100}%" class="high"></i><em>${counts.high || 0}</em></span><span><b>Medium</b><i style="width:${((counts.medium || 0) / products.length) * 100}%" class="medium"></i><em>${counts.medium || 0}</em></span><span><b>Low</b><i style="width:${((counts.low || 0) / products.length) * 100}%" class="low"></i><em>${counts.low || 0}</em></span></div></div><div class="report-section"><h3>Product Risk Table</h3><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Product</th><th>Category</th><th>Demand</th><th>Inventory</th><th>Coverage</th><th>Stockout</th><th>Overstock</th><th>Risk</th><th>Action</th></tr></thead><tbody>${tableRows}</tbody></table></div></div><div class="report-section"><h3>Recommendations</h3>${recommendations}</div><div class="report-actions report-modal-actions"><button class="glass-btn-sm" onclick="downloadCurrentReport(${JSON.stringify(report).replace(/"/g, '&quot;')})"><i class="fa-solid fa-download"></i> Download Report</button><button class="glass-btn-sm" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button><button class="glass-btn-sm" onclick="document.getElementById('explainModalOverlay').classList.remove('show')"><i class="fa-solid fa-xmark"></i> Close</button><details class="report-raw"><summary>View Raw Data</summary><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></details></div></div>`;
    } else {
      const rows = data.entries || data.scenarios || [];
      body.innerHTML = `<div class="report-shell"><div class="report-meta"><span>Generated <strong>${new Date(report.generatedAt).toLocaleString()}</strong></span><span>Dataset <strong>${escapeHtml(report.dataset)}</strong></span></div><div class="report-summary-grid"><div class="report-summary-card"><small>Records</small><strong>${rows.length}</strong></div><div class="report-summary-card"><small>Report Type</small><strong>${escapeHtml(report.type)}</strong></div></div><div class="report-section"><h3>Report Data</h3><div class="report-table-wrap"><table class="report-table"><tbody>${rows.length ? rows.slice(0, 50).map(row => `<tr><td>${escapeHtml(row.product_name || row.name || row.productId || 'Record')}</td><td>${escapeHtml(row.status || row.action || '—')}</td><td>${escapeHtml(row.timestamp || row.createdAt || '')}</td></tr>`).join('') : '<tr><td>Report data unavailable</td></tr>'}</tbody></table></div></div><div class="report-actions report-modal-actions"><button class="glass-btn-sm" onclick="downloadCurrentReport(${JSON.stringify(report).replace(/"/g, '&quot;')})"><i class="fa-solid fa-download"></i> Download Report</button><button class="glass-btn-sm" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button><button class="glass-btn-sm" onclick="document.getElementById('explainModalOverlay').classList.remove('show')"><i class="fa-solid fa-xmark"></i> Close</button></div></div>`;
    }
  } catch (error) {
    body.innerHTML = `<div class="report-error"><strong>Unable to load report</strong><p>${escapeHtml(error.message)}</p><button class="glass-btn-sm" onclick="viewReport('${escapeHtml(reportId)}')"><i class="fa-solid fa-rotate"></i> Retry</button></div>`;
  }
}

let activeRiskReport = null;

function reportDate(value) {
  return value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

function riskValue(value, suffix = '') {
  return Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('en-IN')}${suffix}` : '—';
}

function riskMetric(label, value, tone = '') {
  return `<div class="risk-detail-metric ${tone}"><small>${label}</small><strong>${value}</strong></div>`;
}

function reportForecastPeriod(report, products) {
  if (report.data?.forecast_period) return String(report.data.forecast_period);
  const months = products.map(product => Number(product.month)).filter(Number.isFinite);
  if (!months.length) return 'Not provided';
  const first = Math.min(...months);
  const last = Math.max(...months);
  return first === last ? `Month ${first}` : `Months ${first}-${last}`;
}

function showRiskProductDetails(index) {
  const product = activeRiskReport?.products?.[index];
  const panel = document.getElementById('riskProductDetails');
  if (!product || !panel) return;
  const risk = product.risk || product;
  const interval = risk.prediction_interval || {};
  panel.innerHTML = `<div class="risk-detail-header"><div><span class="report-eyebrow">Selected product</span><h3>${escapeHtml(product.name || product.id)}</h3><span>${escapeHtml(product.category || 'Uncategorized')} · ${riskBadge(risk.risk_level)}</span></div><button class="icon-btn" title="Close product details" aria-label="Close product details" onclick="this.closest('.risk-detail-panel').classList.remove('show')"><i class="fa-solid fa-xmark"></i></button></div><div class="risk-detail-grid">${riskMetric('Demand Forecast', riskValue(risk.predicted_demand, ' units'), 'accent')}${riskMetric('Prediction Interval', `${riskValue(interval.lower)} – ${riskValue(interval.upper)} units`)}${riskMetric('Inventory Coverage', riskValue(risk.inventory_coverage_days, ' days'))}${riskMetric('Safety Stock', riskValue(risk.safety_stock, ' units'))}${riskMetric('Reorder Point', riskValue(risk.reorder_point, ' units'))}${riskMetric('Stockout Probability', riskValue(risk.stockout_probability, '%'), 'critical')}${riskMetric('Overstock Probability', riskValue(risk.overstock_probability, '%'), 'warning')}${riskMetric('Demand Volatility', riskValue(risk.demand_volatility_cv, '%'))}${riskMetric('Forecast Confidence', riskValue(risk.forecast_confidence, '%'), 'success')}</div><div class="risk-detail-action"><small>Recommended action</small><strong>${escapeHtml(risk.recommended_action || 'Not provided')}</strong><p>${escapeHtml(risk.action_reason || 'No rationale provided in the report data.')}</p></div>`;
  panel.classList.add('show');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderRiskReport(report) {
  const data = report.data || {};
  const products = data.products || [];
  const body = document.getElementById('explainModalBody');
  if (!body) return;
  activeRiskReport = { ...report, products };
  const getRisk = product => product.risk || product;
  const counts = products.reduce((result, product) => { const level = String(getRisk(product).risk_level || 'low').toLowerCase(); result[level] = (result[level] || 0) + 1; return result; }, {});
  const sum = field => products.reduce((total, product) => total + (Number(getRisk(product)[field]) || 0), 0);
  const totalInventory = products.reduce((total, product) => total + (Number(product.inventory) || 0), 0);
  const totalDemand = sum('predicted_demand');
  const tableRows = products.map((product, index) => { const risk = getRisk(product); return `<tr><td><button class="report-product-link" onclick="showRiskProductDetails(${index})">${escapeHtml(product.name || product.id || 'Product')}</button><small>${escapeHtml(product.category || 'Uncategorized')}</small></td><td>${riskValue(risk.predicted_demand)}</td><td>${riskValue(product.inventory)}</td><td>${riskValue(risk.daily_demand, ' / day')}</td><td>${riskValue(risk.inventory_coverage_days, ' days')}</td><td>${riskValue(risk.safety_stock)}</td><td>${riskValue(risk.reorder_point)}</td><td>${riskValue(risk.stockout_probability, '%')}</td><td>${riskValue(risk.overstock_probability, '%')}</td><td>${riskValue(risk.forecast_confidence, '%')}</td><td>${riskBadge(risk.risk_level)}</td><td><strong>${escapeHtml(risk.recommended_action || '—')}</strong></td></tr>`; }).join('');
  const recommendations = products.filter(product => ['high', 'critical'].includes(String(getRisk(product).risk_level).toLowerCase())).map(product => { const risk = getRisk(product); return `<article class="report-recommendation"><div class="recommendation-title"><strong>${escapeHtml(product.name || product.id)}</strong>${riskBadge(risk.risk_level)}</div><p><b>Reason:</b> ${escapeHtml(risk.action_reason || 'Not provided')}</p><p><b>Recommendation:</b> ${escapeHtml(risk.recommended_action || 'Not provided')}</p><p><b>Expected impact:</b> ${risk.recommended_order_qty ? `restore approximately ${riskValue(risk.recommended_order_qty, ' units')} of inventory coverage` : 'Not provided'}</p></article>`; }).join('') || '<div class="report-empty">No high-risk products in the active dataset.</div>';
  const distribution = ['critical', 'high', 'medium', 'low'].map(level => `<div class="risk-distribution-row"><span>${level.charAt(0).toUpperCase() + level.slice(1)}</span><div><i class="risk-bar risk-${level}" style="width:${products.length ? (counts[level] || 0) / products.length * 100 : 0}%"></i></div><strong>${counts[level] || 0}</strong></div>`).join('');
  body.innerHTML = `<div class="report-shell professional-report"><div class="report-hero"><div><span class="report-eyebrow">ForecastAI intelligence</span><h2>Inventory Risk Report</h2><p>Evidence-led inventory exposure across the current active dataset.</p></div><div class="report-hero-mark"><i class="fa-solid fa-shield-halved"></i><span>LIVE REPORT</span></div></div><div class="report-meta"><span>Generated <strong>${reportDate(report.generatedAt)}</strong></span><span>Dataset <strong>${escapeHtml(report.dataset || 'Current Active Dataset')}</strong></span><span>Forecast period <strong>Current active period</strong></span></div><div class="report-summary-grid"><div class="report-summary-card"><small>Total Products</small><strong>${products.length}</strong></div><div class="report-summary-card"><small>High Risk Products</small><strong class="critical-text">${(counts.high || 0) + (counts.critical || 0)}</strong></div><div class="report-summary-card"><small>Medium Risk Products</small><strong class="warning-text">${counts.medium || 0}</strong></div><div class="report-summary-card"><small>Low Risk Products</small><strong class="success-text">${counts.low || 0}</strong></div><div class="report-summary-card"><small>Total Inventory</small><strong>${fmtNum(totalInventory)}</strong></div><div class="report-summary-card"><small>Total Predicted Demand</small><strong>${fmtNum(totalDemand)}</strong></div><div class="report-summary-card"><small>Total Stockout Risk</small><strong class="critical-text">${riskValue(sum('stockout_probability'), '%')}</strong></div><div class="report-summary-card"><small>Total Overstock Risk</small><strong class="warning-text">${riskValue(sum('overstock_probability'), '%')}</strong></div></div><div class="report-section report-distribution"><div class="report-section-heading"><div><span class="report-eyebrow">Portfolio view</span><h3>Risk Distribution</h3></div><span class="report-section-note">${products.length} products assessed</span></div>${distribution}</div><div class="report-section"><div class="report-section-heading"><div><span class="report-eyebrow">Traceable model output</span><h3>Product Risk Table</h3></div><span class="report-section-note">Select a product for details</span></div><div class="report-table-wrap"><table class="report-table risk-product-table"><thead><tr><th>Product</th><th>Demand</th><th>Inventory</th><th>Daily Demand</th><th>Coverage</th><th>Safety Stock</th><th>Reorder Point</th><th>Stockout</th><th>Overstock</th><th>Confidence</th><th>Risk</th><th>Action</th></tr></thead><tbody>${tableRows || '<tr><td colspan="12">No product risk data available.</td></tr>'}</tbody></table></div><div class="risk-detail-panel" id="riskProductDetails"></div></div><div class="report-section"><div class="report-section-heading"><div><span class="report-eyebrow">Prioritized actions</span><h3>Recommendations</h3></div></div><div class="report-recommendations">${recommendations}</div></div><details class="report-raw"><summary>View Raw Data</summary><pre>${escapeHtml(JSON.stringify(report.data, null, 2))}</pre></details><div class="report-actions report-modal-actions"><button class="predict-btn" onclick="downloadCurrentReport(activeRiskReport)"><i class="fa-solid fa-download"></i> Download Report</button><button class="glass-btn-sm" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button><button class="glass-btn-sm" onclick="document.getElementById('explainModalOverlay').classList.remove('show')"><i class="fa-solid fa-xmark"></i> Close</button></div></div>`;
  const periodEl = body.querySelector('.report-meta span:last-child strong');
  if (periodEl) periodEl.textContent = reportForecastPeriod(report, products);
  const reportEyebrow = body.querySelector('.report-eyebrow');
  if (reportEyebrow) reportEyebrow.textContent = 'ForecastIQ intelligence';
}

async function viewReport(reportId) {
  const body = document.getElementById('explainModalBody');
  const title = document.getElementById('explainModalTitle');
  if (body) body.innerHTML = '<div class="report-loading"><div class="skeleton skeleton-heading"></div><div class="skeleton-report-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><div class="skeleton skeleton-table"></div></div>';
  if (title) title.innerHTML = '<i class="fa-solid fa-file-chart-column"></i> Loading report...';
  document.getElementById('explainModalOverlay')?.classList.add('show');
  try {
    const { report } = await apiFetch(`${API}/intelligence/reports/${encodeURIComponent(reportId)}`);
    if (title) title.innerHTML = `<i class="fa-solid fa-file-chart-column"></i> ${escapeHtml(report.name)}`;
    if (reportId === 'report-risk-current') renderRiskReport(report);
    else legacyViewReportData(report, body);
  } catch (error) {
    if (body) body.innerHTML = `<div class="report-error"><i class="fa-solid fa-triangle-exclamation"></i><strong>Unable to load report</strong><p>${escapeHtml(error.message)}</p><button class="glass-btn-sm" onclick="viewReport('${escapeHtml(reportId)}')"><i class="fa-solid fa-rotate"></i> Retry</button></div>`;
  }
}

function legacyViewReportData(report, body) {
  const rows = report.data?.entries || report.data?.scenarios || [];
  if (!body) return;
  body.innerHTML = `<div class="report-shell"><div class="report-meta"><span>Generated <strong>${reportDate(report.generatedAt)}</strong></span><span>Dataset <strong>${escapeHtml(report.dataset || 'Current active dataset')}</strong></span></div><div class="report-summary-grid"><div class="report-summary-card"><small>Records</small><strong>${rows.length}</strong></div><div class="report-summary-card"><small>Report Type</small><strong>${escapeHtml(report.type || 'REPORT')}</strong></div></div><div class="report-section"><h3>Report Data</h3><div class="report-table-wrap"><table class="report-table"><tbody>${rows.length ? rows.slice(0, 50).map(row => `<tr><td>${escapeHtml(row.product_name || row.name || row.productId || 'Record')}</td><td>${escapeHtml(row.status || row.action || '—')}</td><td>${escapeHtml(row.timestamp || row.createdAt || '')}</td></tr>`).join('') : '<tr><td>Report data unavailable.</td></tr>'}</tbody></table></div></div><div class="report-actions report-modal-actions"><button class="glass-btn-sm" onclick="downloadCurrentReport(${JSON.stringify(report).replace(/"/g, '&quot;')})"><i class="fa-solid fa-download"></i> Download Report</button><button class="glass-btn-sm" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button><button class="glass-btn-sm" onclick="document.getElementById('explainModalOverlay').classList.remove('show')"><i class="fa-solid fa-xmark"></i> Close</button></div></div>`;
}

function downloadCurrentReport(report) {
  downloadTextFile(`${String(report.name || 'forecastai-report').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, JSON.stringify(report, null, 2), 'application/json');
}

async function buildReportsTable() {
  const tbody = document.getElementById('reportsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5">Loading current reports...</td></tr>';
  try {
    const { reports = [] } = await apiFetch(`${API}/intelligence/reports`);
    const typeColors = { LIVE: '#059669' };
    tbody.innerHTML = reports.map(r => `
    <tr>
      <td>${r.name}</td>
      <td><span class="status-badge" style="background:${typeColors[r.type] || '#6b7280'}22;color:${typeColors[r.type] || '#6b7280'}">${r.type}</span></td>
      <td>${r.date}</td>
      <td>${r.detail || 'Current data'}</td>
      <td><button class="glass-btn-sm" onclick="viewReport('${r.id}')"><i class="fa-solid fa-eye"></i> View</button></td>
    </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Unable to load reports: ${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ================================================================
   UPLOAD PAGE
   ================================================================ */

/**
 * Robust CSV parser.
 * - Handles \r\n and \n line endings
 * - Handles quoted fields (including commas inside quotes)
 * - Trims whitespace from headers and values
 * - Does NOT silently drop partial rows — keeps all rows, even ones
 *   with some empty cells, so the user can see what their file contains
 */
function parseCSV(text) {
  if (!text || !text.trim()) return null;

  // Normalize line endings
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalised.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return null;

  // Parse a single CSV line respecting double-quoted fields
  function parseLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } // escaped quote
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim()); current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headerVals = parseLine(lines[0]);
  const headers = headerVals.map(h => h.toLowerCase().replace(/\s+/g, '_'));

  if (!headers.length) return null;

  // Keep ALL data rows including ones with some empty cells
  const rows = lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] !== undefined ? vals[i] : '';
    });
    return obj;
  });

  // Detect column types: numeric if every non-empty value parses as a number
  const columnTypes = {};
  headers.forEach(h => {
    const nonEmpty = rows.map(r => r[h]).filter(v => v !== '');
    columnTypes[h] = nonEmpty.length > 0 && nonEmpty.every(v => !isNaN(Number(v)))
      ? 'numeric'
      : 'categorical';
  });

  return {
    headers,
    headerOriginal: headerVals.map(h => h.trim()),
    rows,
    columnTypes,
    totalRows: rows.length,
  };
}

/**
 * Validate that the parsed CSV has the columns the ML model needs.
 * Returns { ok, error, warnings, summary }
 */
function validateCSVStructure(parsed) {
  if (!parsed) return { ok: false, error: 'File is empty or unreadable.', warnings: [], summary: null };

  const warnings = [];

  // Check required columns
  const missing = REQUIRED_COLS.filter(c => !parsed.headers.includes(c));
  if (missing.length) {
    return {
      ok: false,
      error: `Missing required columns: ${missing.join(', ')}. Your file has: ${parsed.headers.join(', ')}.`,
      warnings,
      summary: null
    };
  }

  // Count rows with issues
  let blankRows = 0, nonNumericRows = 0, negativeRows = 0;
  parsed.rows.forEach(r => {
    const hasBlank = REQUIRED_COLS.some(c => r[c] === '' || r[c] === undefined);
    const hasNonNum = REQUIRED_COLS.some(c => r[c] !== '' && isNaN(Number(r[c])));
    const hasNeg = REQUIRED_COLS.filter(c => c !== 'month').some(c => Number(r[c]) < 0);
    if (hasBlank) blankRows++;
    if (hasNonNum) nonNumericRows++;
    if (hasNeg) negativeRows++;
  });

  if (nonNumericRows > 0) {
    return {
      ok: false,
      error: `${nonNumericRows} row(s) have non-numeric values in required columns (sales, inventory, price, month, demand). Check your file.`,
      warnings,
      summary: null
    };
  }

  // Valid rows = rows where all required cols are filled and numeric
  const validRows = parsed.rows.filter(r =>
    REQUIRED_COLS.every(c => r[c] !== '' && r[c] !== undefined && !isNaN(Number(r[c])))
  );

  if (validRows.length < 2) {
    return {
      ok: false,
      error: `Only ${validRows.length} fully valid row(s) found. Need at least 2 rows with all required columns filled.`,
      warnings,
      summary: null
    };
  }

  if (blankRows > 0) warnings.push(`${blankRows} row(s) have blank cells in required columns and will be skipped during training.`);
  if (negativeRows > 0) warnings.push(`${negativeRows} row(s) have negative values — check for data entry errors.`);

  const summary = {
    totalRows: parsed.rows.length,
    validRows: validRows.length,
    skippedRows: parsed.rows.length - validRows.length,
    columns: parsed.headers.length,
    columnTypes: parsed.columnTypes,
    hasProduct: parsed.headers.includes('product'),
    hasLeadTime: parsed.headers.includes('lead_time'),
    hasCategory: parsed.headers.includes('category'),
    monthRange: (() => {
      const months = validRows.map(r => Number(r.month)).filter(v => !isNaN(v));
      return months.length ? `${Math.min(...months)} – ${Math.max(...months)}` : '—';
    })(),
  };

  return { ok: true, error: null, warnings, summary };
}

async function persistUploadedDataset() {
  if (!uploadedCSVData) throw new Error('No dataset loaded.');
  const response = await apiFetch(`${API}/intelligence/datasets`, {
    method: 'POST',
    body: JSON.stringify({ name: uploadedFileName, headers: uploadedCSVData.headers, rows: uploadedCSVData.rows })
  });
  uploadedDatasetId = response.dataset.id;
  localStorage.setItem('forecastai_dataset_id', uploadedDatasetId);
  return response.dataset;
}

function handleFile(file) {
  if (!file) return;
  const msg = document.getElementById('validationMsg');
  const preview = document.getElementById('previewSection');

  // Reset state
  uploadedCSVData = null;
  uploadedFileName = '';
  if (preview) preview.style.display = 'none';
  if (msg) { msg.className = 'validation-msg'; msg.textContent = ''; }

  // Reset Start Forecast button to disabled until validated
  const startBtn = document.getElementById('btnStartForecast');
  if (startBtn) { startBtn.style.opacity = '0.5'; startBtn.disabled = true; }

  // Extension check
  if (!file.name.toLowerCase().endsWith('.csv')) {
    if (msg) { msg.className = 'validation-msg error'; msg.textContent = '✗ Invalid file type. Please upload a .CSV file.'; }
    return;
  }

  // Size check (50 MB)
  if (file.size > 50 * 1024 * 1024) {
    if (msg) { msg.className = 'validation-msg error'; msg.textContent = '✗ File too large. Maximum size is 50 MB.'; }
    return;
  }

  if (msg) { msg.className = 'validation-msg info'; msg.textContent = '⏳ Reading file…'; }

  const reader = new FileReader();
  reader.onload = e => {
    const parsed = parseCSV(e.target.result);

    if (!parsed) {
      if (msg) { msg.className = 'validation-msg error'; msg.textContent = '✗ File appears empty or has only a header row. Add data rows and try again.'; }
      return;
    }

    const check = validateCSVStructure(parsed);

    if (!check.ok) {
      if (msg) { msg.className = 'validation-msg error'; msg.textContent = `✗ ${check.error}`; }
      // Still show preview so user can see what the file actually contains
      if (preview) { preview.style.display = 'block'; buildUploadPreviewTable(parsed, false); }
      return;
    }

    // Store valid data
    uploadedCSVData = parsed;
    uploadedFileName = file.name;

    // Extract unique products/categories and populate dropdowns
    populateDropdownsFromCSV(parsed);

    // Build success message
    let statusMsg = `✓ "${file.name}" — ${check.summary.validRows} valid rows, ${check.summary.columns} columns detected.`;
    if (check.summary.skippedRows > 0) statusMsg += ` (${check.summary.skippedRows} rows skipped)`;
    statusMsg += ' Click "Validate Data" to inspect.';
    if (msg) { msg.className = 'validation-msg success'; msg.textContent = statusMsg; }

    // Show preview with all rows
    if (preview) { preview.style.display = 'block'; buildUploadPreviewTable(parsed, true); }
  };

  reader.onerror = () => {
    if (msg) { msg.className = 'validation-msg error'; msg.textContent = '✗ Could not read file. It may be corrupted. Please try again.'; }
  };

  reader.readAsText(file);
}

/**
 * After a CSV is uploaded with a 'product' column, extract unique
 * products/categories and update the product/filter dropdowns throughout the app.
 */
function populateDropdownsFromCSV(parsed) {
  if (!parsed || !parsed.headers.includes('product')) return;

  const products = [...new Set(parsed.rows.map(r => r.product).filter(Boolean))].sort();
  const categories = parsed.headers.includes('category')
    ? [...new Set(parsed.rows.map(r => r.category).filter(Boolean))].sort()
    : [];

  // All dropdowns that hold product lists
  const productDropdownIds = [
    'analyticsProduct', 'forecastProduct', 'scenarioProduct'
  ];

  productDropdownIds.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    // Keep "All Products" as first option if present
    const hasAll = id === 'analyticsProduct';
    const oldVal = sel.value;
    sel.innerHTML = '';
    if (hasAll) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'All Products';
      sel.appendChild(opt);
    }
    products.forEach(p => {
      const opt = document.createElement('option');
      // Map display name to the ID format used by the backend catalogue
      opt.value = p.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      opt.textContent = p;
      opt.dataset.displayName = p;
      sel.appendChild(opt);
    });
    // Restore previous selection if still valid
    if (oldVal && [...sel.options].some(o => o.value === oldVal)) {
      sel.value = oldVal;
    }
  });

  // Store extracted metadata on the parsed object for later use
  parsed._products = products;
  parsed._categories = categories;

  console.log(`[CSV] Populated dropdowns with ${products.length} products, ${categories.length} categories`);
}

function buildUploadPreviewTable(parsed, isValid) {
  const wrap = document.getElementById('previewTableWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  // Summary bar above table
  const summaryDiv = document.createElement('div');
  summaryDiv.style.cssText = 'padding:8px 16px;font-size:0.78rem;color:var(--text-muted);border-bottom:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap;background:var(--surface2)';
  summaryDiv.innerHTML = `
    <span><strong style="color:var(--text)">${parsed.rows.length}</strong> Rows</span>
    <span><strong style="color:var(--text)">${parsed.headers.length}</strong> Columns</span>
    <span>Missing values: <strong style="color:var(--text)">${parsed.rows.reduce((count, row) => count + parsed.headers.filter(header => row[header] === '' || row[header] === undefined).length, 0)}</strong></span>
    <span>Duplicates: <strong style="color:var(--text)">${parsed.rows.length - new Set(parsed.rows.map(row => JSON.stringify(row))).size}</strong></span>
    <span>Products: <strong style="color:var(--text)">${parsed.headers.includes('product') ? new Set(parsed.rows.map(row => row.product).filter(Boolean)).size : '—'}</strong></span>
    <span>Columns: <strong style="color:var(--text)">${parsed.headers.join(', ')}</strong></span>
  `;
  wrap.appendChild(summaryDiv);

  // Scrollable table container — directly inside the table-wrapper
  // (no nested overflow needed since .table-wrapper already handles scroll)
  const scroll = document.createElement('div');
  scroll.style.cssText = 'max-height:360px;overflow-y:auto;overflow-x:auto';

  const table = document.createElement('table');
  table.style.cssText = 'min-width:100%;border-collapse:collapse;font-size:0.8rem';

  // Head
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  parsed.headers.forEach((h, idx) => {
    const th = document.createElement('th');
    const origName = (parsed.headerOriginal?.[idx] || h);
    const colType = parsed.columnTypes?.[h] || 'text';
    const isReq = REQUIRED_COLS.includes(h);
    th.style.cssText = 'padding:8px 12px;text-align:left;white-space:nowrap;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.4px;background:var(--surface2);border-bottom:2px solid var(--border)';
    th.innerHTML = `
      ${origName}
      <span style="display:block;font-size:0.62rem;font-weight:400;color:${isReq ? '#2563eb' : 'var(--text-muted)'};margin-top:1px">
        ${colType}${isReq ? ' · required' : ''}
      </span>`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  // Body — show all rows up to 50, then summary
  const tbody = document.createElement('tbody');
  const displayRows = parsed.rows.slice(0, 50);
  displayRows.forEach((row, rowIdx) => {
    const tr = document.createElement('tr');
    tr.style.background = rowIdx % 2 === 0 ? '' : 'var(--surface2)';
    parsed.headers.forEach(h => {
      const td = document.createElement('td');
      td.style.cssText = 'padding:7px 12px;border-bottom:1px solid var(--border);white-space:nowrap';
      const val = row[h];
      const isEmpty = val === '' || val === undefined;
      const isNum = !isNaN(Number(val)) && val !== '';
      td.textContent = isEmpty ? '—' : val;
      if (isEmpty) td.style.color = '#dc2626';
      else if (!isNum && REQUIRED_COLS.includes(h)) { td.style.color = '#d97706'; td.title = 'Non-numeric in required column'; }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  if (parsed.rows.length > 50) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = parsed.headers.length;
    td.style.cssText = 'text-align:center;padding:10px;color:var(--text-muted);font-size:0.75rem;font-style:italic;background:var(--surface2)';
    td.textContent = `… and ${parsed.rows.length - 50} more rows (showing first 50)`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
}

/* ================================================================
   ML PAGE (Linear Regression — unchanged logic)
   ================================================================ */
let mlDataset = [];
const mlTrainingResults = {};

function buildMlDataTable() {
  const tbody = document.getElementById('mlDataBody');
  if (!tbody) return;
  tbody.innerHTML = mlDataset.map((row, i) => `
    <tr>
      <td><input type="number" value="${row.x}" onchange="mlDataset[${i}].x=+this.value"/></td>
      <td><input type="number" value="${row.y}" onchange="mlDataset[${i}].y=+this.value"/></td>
      <td><button class="ml-del-btn" onclick="mlDeleteRow(${i})"><i class="fa-solid fa-xmark"></i></button></td>
    </tr>`).join('');
}

function mlAddRow() {
  const lastX = mlDataset.length ? mlDataset[mlDataset.length - 1].x : 0;
  mlDataset.push({ x: lastX + 1, y: 0 }); buildMlDataTable();
}

function mlDeleteRow(i) {
  if (mlDataset.length <= 2) { showToast('Need at least 2 data points'); return; }
  mlDataset.splice(i, 1); buildMlDataTable();
}

function linearRegression(data) {
  const n = data.length;
  const xm = data.reduce((s, d) => s + d.x, 0) / n;
  const ym = data.reduce((s, d) => s + d.y, 0) / n;
  let num = 0, den = 0;
  data.forEach(d => { num += (d.x - xm) * (d.y - ym); den += (d.x - xm) ** 2; });
  const b1 = den === 0 ? 0 : num / den;
  const b0 = ym - b1 * xm;
  return { b0, b1, predict: x => b0 + b1 * x };
}

function calcRMSE(data, predict) { return Math.sqrt(data.reduce((s, d) => s + (d.y - predict(d.x)) ** 2, 0) / data.length); }
function calcR2(data, predict) {
  const ym = data.reduce((s, d) => s + d.y, 0) / data.length;
  const ssTot = data.reduce((s, d) => s + (d.y - ym) ** 2, 0);
  const ssRes = data.reduce((s, d) => s + (d.y - predict(d.x)) ** 2, 0);
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

function runLinearRegression() {
  document.querySelectorAll('#mlDataBody tr').forEach((tr, i) => {
    const inputs = tr.querySelectorAll('input');
    if (inputs[0] && inputs[1] && mlDataset[i]) { mlDataset[i].x = parseFloat(inputs[0].value) || mlDataset[i].x; mlDataset[i].y = parseFloat(inputs[1].value) || mlDataset[i].y; }
  });
  const data = [...mlDataset].sort((a, b) => a.x - b.x);
  if (data.length < 2) {
    showToast('No data available for model training.');
    return;
  }
  const splitIndex = Math.max(1, Math.floor(data.length * 0.75));
  const trainData = data.slice(0, splitIndex);
  const testData = data.slice(splitIndex);
  const modelData = trainData.length >= 2 ? trainData : data;
  const { b0, b1, predict } = linearRegression(modelData);
  const metricsData = testData.length ? testData : modelData;
  const rmse = calcRMSE(metricsData, predict);
  const r2 = calcR2(metricsData, predict);
  setEl('mlSlope', b1.toFixed(4)); setEl('mlIntercept', b0.toFixed(4));
  setEl('mlRmse', rmse.toFixed(2)); setEl('mlR2', (r2 * 100).toFixed(1) + '%');
  document.getElementById('mlMetrics').style.display = 'grid';
  document.getElementById('mlModelBadge').style.display = '';
  document.getElementById('mlModelBadge').textContent = 'Linear Regression';
  const fittedY = data.map(d => +predict(d.x).toFixed(2));
  const futureDays = parseInt(document.getElementById('mlDaysSlider')?.value || 5);
  const lastX = data[data.length - 1].x;
  const futureX = Array.from({ length: futureDays }, (_, i) => lastX + i + 1);
  const futureY = futureX.map(x => +predict(x).toFixed(2));
  buildMlChart(data, fittedY, futureX, futureY);
  buildMlResultsTable(futureX, futureY, data[data.length - 1].y);
  setEl('mlSuccessMsg', `AI predicts a ${((futureY[futureY.length - 1] - data[data.length - 1].y) / data[data.length - 1].y * 100).toFixed(1)}% change over ${futureDays} days · R²=${(r2 * 100).toFixed(1)}% · RMSE=${rmse.toFixed(2)}`);
  document.getElementById('mlSuccess').style.display = 'flex';
  document.getElementById('mlResultsCard').style.display = '';
  showToast('Linear Regression complete');
}

function buildMlChart(data, fittedY, futureX, futureY) {
  destroyChart('mlChart');
  const ctx = document.getElementById('mlChart'); if (!ctx) return;
  charts['mlChart'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [...data.map(d => `Day ${d.x}`), ...futureX.map(x => `Day ${x}`)],
      datasets: [
        { label: 'Actual Sales', data: [...data.map(d => d.y), ...Array(futureX.length).fill(null)], borderColor: '#3E92CC', tension: 0.4, pointRadius: 4 },
        { label: 'Regression Line', data: [...fittedY, ...futureY], borderColor: '#00d4ff', borderDash: [5, 5], tension: 0.4, pointRadius: 2 },
        { label: 'Future Prediction', data: [...Array(data.length).fill(null), ...futureY], borderColor: '#10b981', tension: 0.4, pointRadius: 4 }
      ]
    },
    options: chartDefaults()
  });
}

function buildMlResultsTable(futureX, futureY, lastActual) {
  const tbody = document.getElementById('mlResultsBody'); if (!tbody) return;
  tbody.innerHTML = futureX.map((x, i) => {
    const diff = futureY[i] - lastActual;
    const trend = diff >= 0 ? '↑ Upward' : '↓ Downward';
    return `<tr><td>Day ${x}</td><td>${futureY[i].toFixed(2)}</td><td>${diff >= 0 ? '+' : ''}${diff.toFixed(2)}</td><td>${trend}</td></tr>`;
  }).join('');
}

async function loadMlSchema() {
  const datasetSelect = document.getElementById('mlDatasetSelect');
  if (datasetSelect && !datasetSelect._bound) {
    datasetSelect._bound = true;
    datasetSelect.addEventListener('change', loadMlSchema);
  }
  try {
    if (datasetSelect && !datasetSelect._loaded) {
      const response = await apiFetch(`${API}/intelligence/datasets`);
      response.datasets?.forEach(dataset => {
        const option = document.createElement('option');
        option.value = dataset.id;
        option.textContent = `${dataset.name} (${dataset.rowCount} rows)`;
        datasetSelect.appendChild(option);
      });
      if (uploadedDatasetId && [...datasetSelect.options].some(option => option.value === uploadedDatasetId)) datasetSelect.value = uploadedDatasetId;
      datasetSelect._loaded = true;
    }
    const query = datasetSelect?.value ? `?datasetId=${encodeURIComponent(datasetSelect.value)}` : '';
    const schema = await apiFetch(`${API}/intelligence/ml-schema${query}`);
    const targetSelect = document.getElementById('mlTargetSelect');
    const selectedTarget = targetSelect?.value || (schema.headers.includes('demand') ? 'demand' : schema.headers[0]);
    if (targetSelect) {
      targetSelect.innerHTML = schema.headers.map(header => `<option value="${header}">${header}</option>`).join('');
      targetSelect.value = schema.headers.includes(selectedTarget) ? selectedTarget : schema.headers[0] || '';
    }
    const featureBox = document.getElementById('mlFeatureSelect');
    if (featureBox) featureBox.innerHTML = schema.headers.filter(header => header !== targetSelect?.value).map(header => `<label style="display:inline-flex;gap:5px;align-items:center;margin:3px 8px 3px 0;font-size:.74rem"><input type="checkbox" value="${header}" checked> ${header}</label>`).join('') || 'No feature columns available.';
    if (targetSelect && !targetSelect._bound) {
      targetSelect._bound = true;
      targetSelect.addEventListener('change', loadMlSchema);
    }
    mlDataset = (schema.rows || []).map((row, index) => ({ x: index + 1, y: Number(row[targetSelect?.value || 'demand']) })).filter(row => Number.isFinite(row.y));
    buildMlDataTable();
  } catch (error) {
    const box = document.getElementById('mlFeatureSelect');
    if (box) box.textContent = `Unable to load dataset schema: ${error.message}`;
  }
}

function renderMlTraining(result, selectedModel) {
  const comparison = document.getElementById('mlComparison');
  const models = result.models || {};
  const names = [selectedModel];
  if (comparison) {
    comparison.style.display = '';
    comparison.innerHTML = `<div class="chart-title">Model Comparison <small>(best by RMSE: ${escapeHtml(result.best_model || '—')})</small></div><table><thead><tr><th>Metric</th>${names.map(name => `<th>${name}</th>`).join('')}</tr></thead><tbody>${['mae', 'mse', 'rmse', 'r2'].map(metric => `<tr><td>${metric.toUpperCase()}</td>${names.map(name => `<td>${models[name]?.[metric] ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  const modelResult = models[selectedModel];
  if (!modelResult) return;
  if (modelResult.model !== selectedModel) throw new Error(`Backend returned ${modelResult.model || 'an unknown model'} for ${selectedModel}.`);
  setEl('mlSlope', selectedModel);
  setEl('mlIntercept', `${modelResult.train_samples} train / ${modelResult.test_samples} test`);
  setEl('mlRmse', modelResult.rmse);
  setEl('mlR2', modelResult.r2 ?? '—');
  setEl('mlMae', modelResult.mae ?? '—');
  setEl('mlMse', modelResult.mse ?? '—');
  document.getElementById('mlMetrics').style.display = 'grid';
  document.getElementById('mlModelBadge').style.display = '';
  document.getElementById('mlModelBadge').textContent = modelResult.model || selectedModel || 'Model';
  const resultBody = document.getElementById('mlResultsBody');
  if (resultBody) resultBody.innerHTML = (modelResult.predictions || []).map((row, index) => `<tr><td>Test ${index + 1}</td><td>${row.predicted}</td><td>${row.actual}</td><td>${(row.predicted - row.actual).toFixed(2)}</td><td>${row.predicted >= row.actual ? 'Above actual' : 'Below actual'}</td></tr>`).join('') || '<tr><td colspan="5">No prediction data available.</td></tr>';
  buildMlPredictionChart(modelResult.model, modelResult.predictions || []);
  document.getElementById('mlResultsCard').style.display = '';
  setEl('mlSuccessMsg', `${selectedModel} evaluated on ${modelResult.test_samples} unseen chronological rows. RMSE=${modelResult.rmse}, R²=${modelResult.r2 ?? '—'}`);
  document.getElementById('mlSuccess').style.display = 'flex';
}

function buildMlPredictionChart(model, predictions) {
  destroyChart('mlChart');
  const canvas = document.getElementById('mlChart');
  const empty = document.getElementById('mlChartEmpty');
  if (!canvas) return;
  if (!predictions.length) {
    canvas.style.display = 'none';
    if (empty) { empty.style.display = ''; empty.textContent = 'No prediction data available.'; }
    return;
  }
  canvas.style.display = '';
  if (empty) empty.style.display = 'none';
  charts.mlChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: predictions.map((_, index) => `Test ${index + 1}`), datasets: [
        { label: 'Actual Demand', data: predictions.map(row => row.actual), borderColor: '#B96565', tension: .25, pointRadius: 3 },
        { label: `${model} Prediction`, data: predictions.map(row => row.predicted), borderColor: '#5F8B70', tension: .25, pointRadius: 3 }
      ]
    },
    options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, title: { display: true, text: `Actual Demand vs ${model} Predicted Demand`, color: '#2F292D' } } }
  });
}

async function runMlTraining(model) {
  const featureBox = document.getElementById('mlFeatureSelect');
  const features = [...(featureBox?.querySelectorAll('input[type="checkbox"]') || [])].filter(input => input.checked).map(input => input.value);
  const target = document.getElementById('mlTargetSelect')?.value || 'demand';
  const datasetId = document.getElementById('mlDatasetSelect')?.value || undefined;
  const resultBody = document.getElementById('mlResultsBody');
  const chart = document.getElementById('mlChart');
  const empty = document.getElementById('mlChartEmpty');
  destroyChart('mlChart');
  document.getElementById('mlResultsCard').style.display = 'none';
  document.getElementById('mlSuccess').style.display = 'none';
  document.getElementById('mlModelBadge').style.display = 'none';
  if (resultBody) resultBody.innerHTML = '';
  if (chart) chart.style.display = 'none';
  if (empty) { empty.style.display = ''; empty.textContent = `Running ${model}...`; }
  try {
    await showLoading(0);
    const result = await apiFetch(`${API}/intelligence/ml-train`, { method: 'POST', body: JSON.stringify({ datasetId, target, features, model, testFraction: 0.25 }) });
    const modelResult = result.models?.[model];
    if (!modelResult) throw new Error(`No ${model} result returned.`);
    mlTrainingResults[model] = modelResult;
    renderMlTraining(result, model);
    showToast(`${model} training complete`);
  } catch (error) {
    const box = document.getElementById('mlComparison');
    if (box) { box.style.display = ''; box.innerHTML = `<div class="validation-msg error" style="display:block">Model training failed: ${escapeHtml(error.message)}</div>`; }
  }
}

function initMlPage() { loadMlSchema(); }

/* ================================================================
   DARK MODE
   ================================================================ */
function setDarkMode(on) {
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
  const icon = document.querySelector('#darkModeToggle i');
  if (icon) icon.className = on ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  const st = document.getElementById('settingsDarkMode');
  if (st) st.checked = on;
  localStorage.setItem('darkMode', on ? '1' : '0');
}

/* ================================================================
   HELP MODAL
   ================================================================ */
const HELP_CONTENT = {
  'intelligence-center': {
    title: 'Intelligence Center Help', icon: 'brain',
    sections: [
      { h: 'Purpose', p: 'This workspace combines live model validation, inventory projection, scenario simulation, explainable agents and budget allocation over the active dataset.' },
      { h: 'How calculations work', p: 'Forecasts and intervals come from the existing Python model. Risk uses the interval, inventory coverage and lead time. Simulation and optimization apply your inputs to those calculated values.' },
      { h: 'Recommended workflow', p: 'Review model health, project the digital twin, test a scenario, run the boardroom, then optimize purchases within an explicit budget.' }
    ]
  },
  dashboard: {
    title: 'Dashboard Help',
    icon: 'gauge-high',
    sections: [
      { h: 'KPI Cards', p: 'The 6 cards show live data pulled from the AI engine: Total Revenue (all products combined), Predicted Demand (AI forecast), Revenue at Risk (value of stock that may stockout), Critical SKUs (products needing immediate action), Overstock SKUs, and Forecast Confidence.' },
      { h: 'Action Required', p: 'Top 3 urgent recommendations from the AI. Click "Act" to go to the Action Center and approve/reject.' },
      { h: 'Charts', p: 'The Demand Outlook bar chart compares current sales vs AI-predicted demand per product. The Risk Pie shows distribution of risk levels across your catalogue.' },
      { h: 'Product Health Matrix', p: 'Full product table with stockout probability bars. Click "Details" to see full explainability for any product.' }
    ]
  },
  forecast: {
    title: 'Demand Intelligence Help',
    icon: 'chart-line',
    sections: [
      { h: 'How it works', p: 'Enter product parameters — sales volume, inventory, price, month and lead time — then click Predict Demand. The AI (Random Forest ensemble) processes these features and returns a demand forecast.' },
      { h: 'Forecast Visualization', p: 'Historical actual demand is shown separately from the forecast. The upper and lower bounds form the prediction interval, and the forecast start marker identifies where the model projection begins.' },
      { h: 'Feature Contributions', p: 'The coloured bars show how much each input feature pushed the prediction up (green) or down (red) relative to the model baseline.' },
      { h: 'Forecast Risk and Decision Insight', p: 'Risk and inventory recommendations use the backend forecast interval, inventory, stockout and overstock calculations, and lead time.' },
      { h: 'Best practice', p: 'Use the most recent month\'s sales data for the most accurate forecast. Lead time should reflect your actual supplier delivery time in days.' }
    ]
  },
  alerts: {
    title: 'Inventory Intelligence Help',
    icon: 'boxes-stacked',
    sections: [
      { h: 'Stockout Probability', p: 'Percentage likelihood of running out of stock before the next reorder arrives, based on predicted demand rate and current inventory.' },
      { h: 'Coverage Days', p: 'How many days your current inventory will last at the predicted demand rate. Below 14 days is considered critical.' },
      { h: 'Recommended Action', p: 'The AI suggests the optimal action: REORDER (stock is low), REDUCE_PRICE (overstock), MONITOR (borderline), or MAINTAIN (healthy stock).' },
      { h: 'Risk Levels', p: 'Critical = immediate action needed. High = action needed within a week. Medium = monitor closely. Low = healthy.' }
    ]
  },
  'scenario-lab': {
    title: 'Scenario Lab Help',
    icon: 'flask',
    sections: [
      { h: 'What is Scenario Lab?', p: 'Scenario Lab lets you model "what-if" situations before they happen. Adjust demand, price, inventory and lead time for two simultaneous scenarios and compare them against the current baseline.' },
      { h: 'Demand Change %', p: 'Simulates a promotional campaign (+%) or demand slump (-%). A +20% means demand is expected to be 20% higher than normal.' },
      { h: 'Price Change %', p: 'Simulates pricing strategy changes. Price increases generally reduce demand; price reductions increase it (price elasticity is modelled).' },
      { h: 'Inventory Change %', p: 'Models a bulk purchase or inventory write-off before the forecast period.' },
      { h: 'Lead Time', p: 'Supplier delivery time in days. Longer lead times require higher safety stock to avoid stockouts.' }
    ]
  },
  copilot: {
    title: 'ForecastIQ Copilot Help',
    icon: 'robot',
    sections: [
      { h: 'What can I ask?', p: 'Ask anything about your inventory, demand forecasts, model performance, or product risks. The Copilot has real-time access to your data.' },
      { h: 'Example questions', items: ['Which products are at critical stockout risk?', 'What is the forecast confidence for Smart Watch S3?', 'Explain why Laptop Pro X1 has a high risk score', 'What does MAPE mean in model performance?', 'Which model performs best on my data?'] },
      { h: 'Navigation links', p: 'Copilot responses often include blue navigation buttons that take you directly to the relevant page for deeper analysis.' },
      { h: 'Clear Chat', p: 'Use the Clear button in the header to start a fresh conversation.' }
    ]
  },
  'action-center': {
    title: 'Action Center Help',
    icon: 'bolt',
    sections: [
      { h: 'Purpose', p: 'The Action Center aggregates all AI recommendations in one place. Every product that needs attention is shown with full context so you can make fast, informed decisions.' },
      { h: 'Approve', p: 'Records your approval of the AI recommendation and logs it in the Audit Trail. The system tracks approved actions for compliance.' },
      { h: 'Reject', p: 'Dismisses the recommendation. The AI will regenerate its advice on the next model run if the risk remains.' },
      { h: 'Snooze', p: 'Defers the action for review later. Useful for recommendations that are valid but not yet actionable.' },
      { h: 'Explain', p: 'Opens a full explainability panel showing why the AI made this recommendation, including feature contributions and risk drivers.' }
    ]
  },
  'model-lab': {
    title: 'Model Lab Help',
    icon: 'microchip',
    sections: [
      { h: 'Metrics explained', p: '' },
      { items: ['MAE (Mean Absolute Error): Average absolute difference between predicted and actual demand. Lower is better.', 'RMSE: Square root of mean squared errors. Penalises large errors more. Lower is better.', 'MAPE: Mean Absolute Percentage Error. Below 10% is excellent, 10–20% is good.', 'R²: How well the model explains variance. Closer to 1.0 is better.', 'Bias: Systematic over/under-prediction. Close to 0 is ideal.'] },
      { h: 'Feature Importance', p: 'Shows which input variables most influenced the model\'s predictions. Higher bars mean that feature contributed more to forecasting accuracy.' },
      { h: 'Best Model', p: 'The model marked BEST achieved the highest combined score across all metrics and is used for live forecasting.' }
    ]
  },
  upload: {
    title: 'Dataset Upload Help',
    icon: 'upload',
    sections: [
      { h: 'Required columns', items: ['sales — numeric, current sales volume', 'inventory — numeric, current stock level', 'price — numeric, unit selling price', 'month — numeric 1–12, month of the data', 'demand — numeric, actual historical demand'] },
      { h: 'Validate Data', p: 'Checks your CSV for missing columns, non-numeric values and data integrity before sending to the forecast engine.' },
      { h: 'Start Forecast', p: 'Sends the uploaded dataset to the backend ML model. The AI uses all rows to improve its prediction for the last row\'s conditions. Results appear on the Demand Intelligence page.' }
    ]
  },
  analytics: {
    title: 'Analytics Help',
    icon: 'chart-bar',
    sections: [
      { h: 'Dataset', p: 'Analytics uses the active uploaded dataset. The available date range, products and regions are read from valid dataset rows.' },
      { h: 'Filters', p: 'Product, region, date range and Monthly or Weekly frequency are sent to the backend and recalculate the returned data.' },
      { h: 'Demand Trends', p: 'Shows filtered sales history for each available product over the selected periods.' },
      { h: 'Seasonal Analysis', p: 'Shows filtered demand distribution across Q1 (Jan–Mar), Q2 (Apr–Jun), Q3 (Jul–Sep) and Q4 (Oct–Dec), retaining products with missing quarters.' },
      { h: 'Category Comparison', p: 'Side-by-side comparison of Q3 vs Q4 demand by product category.' },
      { h: 'Correlation Heatmap', p: 'Shows how strongly each product\'s demand correlates with key factors (Price, Seasonality, Promotions, Region, Trend). Darker blue = stronger positive correlation.' }
    ]
  },
  audit: {
    title: 'Audit Log Help',
    icon: 'clock-rotate-left',
    sections: [
      { h: 'Purpose', p: 'The Audit Log is a tamper-evident record of every AI recommendation and every human decision made in the Action Center. Use it for compliance, reviews and accountability.' },
      { h: 'Status types', items: ['Approved — recommendation was accepted and acted upon', 'Rejected — recommendation was dismissed', 'Snoozed — deferred for later review', 'Pending — awaiting a decision'] },
      { h: 'Filtering', p: 'Use the filter tabs to narrow entries by decision type. Pagination controls appear below the table.' }
    ]
  },
  'data-quality': {
    title: 'Data Quality Help',
    icon: 'shield-check',
    sections: [
      { h: 'Quality Score', p: 'A 0–100 score representing the overall cleanliness of your dataset. Above 80 is good (green), 60–80 needs attention (amber), below 60 is poor (red).' },
      { h: 'Missing Values', p: 'Rows or cells with empty/null values. High missing value counts degrade model accuracy.' },
      { h: 'Duplicates', p: 'Identical rows that could bias training. The model automatically deduplicates, but a high count suggests data pipeline issues.' },
      { h: 'Outliers', p: 'Values that are statistically extreme (beyond 3 standard deviations). Legitimate spikes (flash sales) can look like outliers — review manually.' },
      { h: 'Upload your own CSV', p: 'Drag a CSV file into the score ring area, then click Run Quality Check to analyse it instead of the default dataset.' }
    ]
  },
  settings: {
    title: 'Settings Help',
    icon: 'gear',
    sections: [
      { h: 'Dark Mode', p: 'Toggles the colour theme between light and dark. Saved to browser storage.' },
      { h: 'Compact Sidebar', p: 'Collapses the sidebar to icon-only mode, giving more space to the content area.' },
      { h: 'API Configuration', p: 'Change the backend URL if your server runs on a different port or host. Click Test Connection to verify.' }
    ]
  },
  ml: {
    title: 'ML Predict Help',
    icon: 'chart-line',
    sections: [
      { h: 'Linear Regression', p: 'Enter day-by-sales training data, set how many future days to predict, then click Run Linear Regression. The model fits a straight line to your data and extrapolates forward.' },
      { h: 'Metrics', items: ['Slope (b₁): Rate of demand change per day', 'Intercept (b₀): Baseline demand at Day 0', 'RMSE: Average prediction error in the same units as sales', 'R²: Percentage of variance explained by the model (higher is better)'] },
      { h: 'Editing data', p: 'Click any cell in the table to edit it. Use the + Add Row button to extend the dataset. The model re-runs instantly on the current table data.' }
    ]
  }
};

function showHelp(pageKey) {
  const content = HELP_CONTENT[pageKey];
  if (!content) return;
  const overlay = document.getElementById('helpModalOverlay');
  const title = document.getElementById('helpModalTitle');
  const body = document.getElementById('helpModalBody');
  if (!overlay || !title || !body) return;
  title.innerHTML = `<i class="fa-solid fa-${content.icon}"></i> ${content.title}`;
  body.innerHTML = content.sections.map(s => `
    <div class="help-section">
      ${s.h ? `<h4>${s.h}</h4>` : ''}
      ${s.p ? `<p>${s.p}</p>` : ''}
      ${s.items ? `<ul>${s.items.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}
    </div>`).join('');
  overlay.classList.add('show');
}

function closeHelp(e) {
  if (e.target === document.getElementById('helpModalOverlay')) {
    document.getElementById('helpModalOverlay').classList.remove('show');
  }
}

function closeExplainModal(e) {
  if (e.target === document.getElementById('explainModalOverlay')) {
    document.getElementById('explainModalOverlay').classList.remove('show');
  }
}

/* ================================================================
   GLOBAL SEARCH
   ================================================================ */
let _searchDebounceTimer = null;
let _searchActiveIndex = -1;
let _searchResults = [];
let _lastScenarioResult = null;

function initGlobalSearch() {
  const input = document.getElementById('globalSearch');
  const dropdown = document.getElementById('searchDropdown');
  const wrap = document.getElementById('searchBarWrap');
  if (!input || !dropdown) return;

  // Focus / blur
  input.addEventListener('focus', () => {
    wrap?.classList.add('search-focused');
    if (input.value.trim().length < 2) {
      showSearchEmpty();
      dropdown.style.display = 'block';
    }
  });

  input.addEventListener('blur', (e) => {
    // Delay so clicks on results register first
    setTimeout(() => {
      dropdown.style.display = 'none';
      wrap?.classList.remove('search-focused');
      _searchActiveIndex = -1;
    }, 180);
  });

  // Keyboard input — debounced
  input.addEventListener('input', () => {
    clearTimeout(_searchDebounceTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      showSearchEmpty();
      dropdown.style.display = 'block';
      return;
    }
    showSearchLoading(q);
    dropdown.style.display = 'block';
    _searchDebounceTimer = setTimeout(() => executeSearch(q), 320);
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.search-result-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _searchActiveIndex = Math.min(_searchActiveIndex + 1, items.length - 1);
      highlightItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _searchActiveIndex = Math.max(_searchActiveIndex - 1, 0);
      highlightItem(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_searchActiveIndex >= 0 && items[_searchActiveIndex]) {
        items[_searchActiveIndex].click();
      } else if (_searchResults.length > 0) {
        navigateSearchResult(_searchResults[0]);
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      input.blur();
    }
  });

  // Ctrl+K global shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
      if (input.value.trim().length < 2) {
        showSearchEmpty();
        dropdown.style.display = 'block';
      }
    }
  });
}

function highlightItem(items) {
  items.forEach((it, i) => {
    it.classList.toggle('search-active', i === _searchActiveIndex);
    if (i === _searchActiveIndex) it.scrollIntoView({ block: 'nearest' });
  });
}

function showSearchEmpty() {
  const inner = document.getElementById('searchDropdownInner');
  if (!inner) return;
  _searchResults = [];
  _searchActiveIndex = -1;
  inner.innerHTML = `
    <div class="search-empty">
      <i class="fa-solid fa-magnifying-glass"></i>
      <span>Search products, forecasts, alerts, scenarios, reports…</span>
    </div>
    <div class="search-footer">
      <span class="search-footer-hint"><span class="search-key">↑↓</span> navigate</span>
      <span class="search-footer-hint"><span class="search-key">↵</span> select</span>
      <span class="search-footer-hint"><span class="search-key">Esc</span> close</span>
    </div>`;
}

function showSearchLoading(q) {
  const inner = document.getElementById('searchDropdownInner');
  if (!inner) return;
  inner.innerHTML = `
    <div class="search-loading">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <span>Searching for "<strong>${escapeHtml(q)}</strong>"…</span>
    </div>`;
}

async function executeSearch(q) {
  try {
    const data = await apiFetch(`${API}/intelligence/search?q=${encodeURIComponent(q)}`);
    _searchResults = data.results || [];
    renderSearchResults(q, _searchResults);
  } catch (err) {
    const inner = document.getElementById('searchDropdownInner');
    if (inner) {
      inner.innerHTML = `
        <div class="search-no-results">
          <strong>Search unavailable</strong>
          <div class="search-suggest">Please check the backend connection and try again.</div>
        </div>`;
    }
  }
}

const TYPE_ICONS = {
  product: 'box',
  inventory: 'warehouse',
  forecast: 'chart-line',
  action: 'bolt',
  scenario: 'flask',
  report: 'file-chart-column',
  page: 'arrow-right',
};
const TYPE_LABELS = {
  product: 'Products',
  inventory: 'Inventory',
  forecast: 'Forecasts',
  action: 'Actions',
  scenario: 'Scenarios',
  report: 'Reports',
  page: 'Navigation',
};

function renderSearchResults(q, results) {
  const inner = document.getElementById('searchDropdownInner');
  if (!inner) return;
  _searchActiveIndex = -1;

  if (!results.length) {
    inner.innerHTML = `
      <div class="search-no-results">
        <strong>No results found for "${escapeHtml(q)}"</strong>
        <div class="search-suggest">Try searching by product name, SKU, category, or alert type.</div>
      </div>`;
    return;
  }

  // Group by type
  const groups = {};
  results.forEach(r => {
    if (!groups[r.type]) groups[r.type] = [];
    groups[r.type].push(r);
  });

  const ORDER = ['product', 'inventory', 'forecast', 'action', 'scenario', 'report', 'page'];
  let html = '';
  let isFirst = true;

  ORDER.forEach(type => {
    const group = groups[type];
    if (!group?.length) return;
    if (!isFirst) html += '<div class="search-group-divider"></div>';
    isFirst = false;
    html += `<div class="search-group-label">${TYPE_LABELS[type] || type}</div>`;
    group.forEach(result => {
      const icon = TYPE_ICONS[result.icon] || TYPE_ICONS[result.type] || 'circle';
      const badgeHtml = result.badge
        ? `<span class="risk-badge risk-${result.badge}" style="font-size:0.62rem;padding:2px 6px">${result.badge}</span>`
        : '';
      const titleHtml = highlightQuery(escapeHtml(result.title || ''), q);
      const subtitleHtml = escapeHtml(result.subtitle || '');
      const metaHtml = result.meta ? escapeHtml(result.meta) : '';

      html += `<div class="search-result-item" tabindex="-1"
        onclick="navigateSearchResult(${JSON.stringify(result).replace(/"/g, '&quot;')})">
        <div class="search-result-icon"><i class="fa-solid fa-${icon}"></i></div>
        <div class="search-result-body">
          <div class="search-result-title">${titleHtml}</div>
          <div class="search-result-subtitle">${subtitleHtml}</div>
          ${metaHtml ? `<div class="search-result-meta">${metaHtml}</div>` : ''}
        </div>
        <div class="search-result-right">
          ${badgeHtml}
          <i class="fa-solid fa-arrow-right search-result-arrow"></i>
        </div>
      </div>`;
    });
  });

  html += `
    <div class="search-footer">
      <span class="search-footer-hint">${results.length} result${results.length !== 1 ? 's' : ''}</span>
      <span class="search-footer-hint"><span class="search-key">↑↓</span> navigate &nbsp;
        <span class="search-key">↵</span> select &nbsp;
        <span class="search-key">Esc</span> close</span>
    </div>`;

  inner.innerHTML = html;
}

function highlightQuery(text, q) {
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'),
    '<span class="search-highlight">$1</span>');
}

function navigateSearchResult(result) {
  // Close dropdown
  const dropdown = document.getElementById('searchDropdown');
  const input = document.getElementById('globalSearch');
  if (dropdown) dropdown.style.display = 'none';
  if (input) input.value = '';

  const productTypes = ['product', 'inventory', 'action', 'forecast'];
  const productId = String(result.id || '').replace(/^(inv-|fc-|act-)/, '');
  if (productTypes.includes(result.type)) pendingSearchProduct = result.title || null;
  if (result.page) navigateTo(result.page);
  if (productTypes.includes(result.type)) {
    setTimeout(() => showProductDetail(productId), 650);
  }
}

/* ================================================================
   AUTH
   ================================================================ */
function logoutUser() {
  localStorage.removeItem('auth_user');
  localStorage.removeItem('auth_token');
  window.location.href = 'auth/login.html';
}

async function testApiConnection() {
  try {
    await apiFetch(`${API}/health`);
    showToast('✓ Backend connection successful');
  } catch (err) {
    showToast('✗ Cannot reach backend: ' + err.message);
  }
}

/* ================================================================
   MAIN DOMContentLoaded
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* Restore dark mode */
  if (localStorage.getItem('darkMode') === '1') setDarkMode(true);

  /* User greeting */
  try {
    const user = JSON.parse(localStorage.getItem('auth_user'));
    if (user) {
      const g = document.getElementById('userGreeting');
      const e = document.getElementById('userIdentifier');
      if (g) g.textContent = user.firstName ? `Hi, ${user.firstName}` : 'Welcome';
      if (e) e.textContent = user.email || user.phone || '';
    }
  } catch (_) { }

  /* Avatar dropdown */
  const avatarBtn = document.getElementById('userAvatarBtn');
  const dropdown = document.getElementById('userDropdown');
  avatarBtn?.addEventListener('click', ev => {
    ev.stopPropagation();
    if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => { if (dropdown) dropdown.style.display = 'none'; });

  /* Navigation */
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => { e.preventDefault(); navigateTo(item.dataset.page); });
  });

  /* Dark mode toggle */
  document.getElementById('darkModeToggle')?.addEventListener('click', () => {
    setDarkMode(document.documentElement.getAttribute('data-theme') !== 'dark');
  });
  document.getElementById('settingsDarkMode')?.addEventListener('change', function () { setDarkMode(this.checked); });
  document.getElementById('compactSidebar')?.addEventListener('change', function () {
    document.documentElement.style.setProperty('--sidebar-w', this.checked ? '62px' : '256px');
  });
  document.getElementById('applyAnalyticsFilters')?.addEventListener('click', () => buildAnalyticsCharts());
  ['analyticsProduct', 'analyticsRegion', 'dateFrom', 'dateTo', 'analyticsGranularity'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => buildAnalyticsCharts());
  });
  document.getElementById('createUserBtn')?.addEventListener('click', createManagedUser);
  ['userSearch', 'userRoleFilter', 'userStatusFilter'].forEach(id => document.getElementById(id)?.addEventListener('input', loadUsers));

  /* Menu toggle (mobile) */
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    const layout = document.querySelector('.app-layout');
    if (sb && layout) layout.classList.toggle('sidebar-collapsed');
  });

  /* Dashboard table search */
  document.getElementById('dashTableSearch')?.addEventListener('input', function () {
    renderDashProductTable(_dashProducts, this.value);
  });

  /* Forecast page controls */
  document.getElementById('runForecastBtn')?.addEventListener('click', runForecastPrediction);
  document.getElementById('downloadForecast')?.addEventListener('click', () => {
    if (!lastForecastResult) return showToast('Run a forecast before exporting.');
    downloadTextFile('forecastai-forecast.csv', Object.entries(lastForecastResult).map(([key, value]) => `${key},"${JSON.stringify(value).replace(/"/g, '""')}"`).join('\n'), 'text/csv');
  });
  document.getElementById('exportReportsCsv')?.addEventListener('click', exportReportsCsv);
  document.getElementById('exportReportsCharts')?.addEventListener('click', exportReportsCharts);
  document.getElementById('printReports')?.addEventListener('click', printReports);

  /* Scenario lab initializes when an authorized user opens the page. */
  document.getElementById('runScenarioBtn')?.addEventListener('click', runScenarioSimulation);
  document.getElementById('useRecommendedModelBtn')?.addEventListener('click', useRecommendedModel);
  document.getElementById('saveScenarioBtn')?.addEventListener('click', saveCurrentScenario);
  document.getElementById('loadScenariosBtn')?.addEventListener('click', loadSavedScenarios);
  document.getElementById('scenarioResetBtn')?.addEventListener('click', () => {
    const ids = ['scDemandA', 'scPriceA', 'scInventoryA', 'scLeadA', 'scDemandB', 'scPriceB', 'scInventoryB', 'scLeadB'];
    const defaults = [0, 0, 0, 7, 20, -10, 30, 14];
    ids.forEach((id, i) => { const el = document.getElementById(id); if (el) { el.value = defaults[i]; el.dispatchEvent(new Event('input')); } });
    const res = document.getElementById('scenarioResults');
    const chartCard = document.getElementById('scenarioChartCard');
    if (res) res.innerHTML = '<div class="empty-state"><i class="fa-solid fa-flask"></i><h3>Ready to simulate</h3><p>Adjust parameters and click Run Simulation</p></div>';
    if (chartCard) chartCard.style.display = 'none';
    destroyChart('scenarioChart');
  });

  /* Copilot — init on first load so it's ready */
  initCopilot();

  /* Action center filter tabs */
  document.getElementById('actionFilterTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('#actionFilterTabs .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    _actionFilter = tab.dataset.filter;
    renderActionCards();
  });

  /* Audit filter tabs */
  document.getElementById('auditFilterTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('#auditFilterTabs .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    _auditFilter = tab.dataset.filter;
    _auditPage = 0;
    renderAuditTable();
  });

  /* Data quality run button */
  document.getElementById('runDQBtn')?.addEventListener('click', runDataQuality);
  initDataQuality();

  /* Upload page */
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone?.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
  fileInput?.addEventListener('change', () => handleFile(fileInput.files[0]));

  document.getElementById('btnValidate')?.addEventListener('click', async () => {
    const msg = document.getElementById('validationMsg');
    if (!uploadedCSVData) {
      if (msg) { msg.className = 'validation-msg error'; msg.textContent = '✗ No file loaded. Please upload a CSV file first.'; }
      return;
    }
    await showLoading(0);
    const check = validateCSVStructure(uploadedCSVData);

    if (!check.ok) {
      if (msg) { msg.className = 'validation-msg error'; msg.textContent = `✗ Validation failed: ${check.error}`; }
      return;
    }

    const s = check.summary;

    try {
      await persistUploadedDataset();
    } catch (error) {
      if (msg) { msg.className = 'validation-msg error'; msg.textContent = `✗ Dataset could not be saved: ${error.message}`; }
      return;
    }

    // Build a detailed validation report
    const warningList = check.warnings.map(w => `<li>${w}</li>`).join('');
    const colTypeItems = s.columnTypes
      ? Object.entries(s.columnTypes).map(([col, type]) => {
        const isReq = REQUIRED_COLS.includes(col);
        return `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:2px 8px;border-radius:12px;font-size:0.68rem;font-weight:600;background:${isReq ? 'rgba(37,99,235,0.08)' : 'var(--surface2)'};color:${isReq ? '#2563eb' : 'var(--text-muted)'};">${col} <em style="font-weight:400">${type}</em></span>`;
      }).join('')
      : '';

    const reportHtml = `
      <div style="margin-top:10px;padding:12px 16px;background:rgba(5,150,105,0.04);border:1px solid rgba(5,150,105,0.2);border-radius:8px">
        <div style="font-size:0.82rem;font-weight:700;color:#059669;margin-bottom:8px">
          <i class="fa-solid fa-circle-check"></i>&nbsp; Dataset validated
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
          <div style="text-align:center;padding:6px;background:#fff;border-radius:6px;border:1px solid var(--border)">
            <div style="font-size:1.1rem;font-weight:800;color:#059669">${s.validRows}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);font-weight:600;text-transform:uppercase">Valid Rows</div>
          </div>
          <div style="text-align:center;padding:6px;background:#fff;border-radius:6px;border:1px solid var(--border)">
            <div style="font-size:1.1rem;font-weight:800;color:${s.skippedRows > 0 ? '#d97706' : '#6b7280'}">${s.skippedRows}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);font-weight:600;text-transform:uppercase">Skipped</div>
          </div>
          <div style="text-align:center;padding:6px;background:#fff;border-radius:6px;border:1px solid var(--border)">
            <div style="font-size:1.1rem;font-weight:800;color:#2563eb">${s.columns}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);font-weight:600;text-transform:uppercase">Columns</div>
          </div>
        </div>
        ${colTypeItems ? `<div style="margin-bottom:6px;font-size:0.72rem;color:var(--text-muted);font-weight:600;margin-bottom:4px">Detected columns:</div><div style="flex-wrap:wrap;display:flex">${colTypeItems}</div>` : ''}
        ${s.monthRange ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px">Month range: <strong>${s.monthRange}</strong></div>` : ''}
        ${warningList ? `<ul style="margin-top:8px;padding-left:16px;font-size:0.74rem;color:#d97706">${warningList}</ul>` : ''}
        <div style="margin-top:10px;font-size:0.78rem;color:var(--text-muted)">
          Ready to forecast — click <strong>Start Forecast</strong> to run the model.
        </div>
      </div>`;

    if (msg) {
      msg.className = 'validation-msg success';
      msg.innerHTML = reportHtml;
    }

    // Mark dataset as validated (enable Start Forecast)
    const startBtn = document.getElementById('btnStartForecast');
    if (startBtn) {
      startBtn.style.opacity = '1';
      startBtn.disabled = false;
    }

    showToast(`✓ Validated and saved: ${s.validRows} valid rows, ${s.columns} columns`);
  });

  document.getElementById('btnStartForecast')?.addEventListener('click', async () => {
    const msg = document.getElementById('validationMsg');
    if (!uploadedCSVData) {
      if (msg) { msg.className = 'validation-msg error'; msg.textContent = '✗ Please upload a CSV file first.'; }
      return;
    }

    // Check the data is valid before sending
    const preCheck = validateCSVStructure(uploadedCSVData);
    if (!preCheck.ok) {
      if (msg) { msg.className = 'validation-msg error'; msg.textContent = `✗ Cannot forecast: ${preCheck.error} — Click "Validate Data" first.`; }
      return;
    }

    const startBtn = document.getElementById('btnStartForecast');
    if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = '0.6'; }

    await showLoading(0);
    const rows = uploadedCSVData.rows;

    try {
      const data = await apiFetch(`${API}/upload-forecast`, {
        method: 'POST',
        body: JSON.stringify({ rows })
      });

      // Navigate to forecast page and show results
      navigateTo('forecast');

      const box = document.getElementById('forecastResultBox');
      if (box) {
        const pi = data.prediction_interval || {};
        const mm = data.model_metrics || {};
        const contribs = data.feature_contributions || [];
        const maxC = Math.max(...contribs.map(c => Math.abs(c.contribution || 0)), 1);

        const contribHtml = contribs.length
          ? `<div style="margin-top:12px;font-size:0.78rem;font-weight:700;color:var(--text);margin-bottom:6px">Why this prediction?</div>
             <div class="explain-panel">
               ${contribs.map(c => {
            const pct = Math.min(100, (Math.abs(c.contribution || 0) / maxC) * 100);
            const dir = (c.direction === 'positive' || Number(c.contribution) >= 0) ? 'positive' : 'negative';
            return `<div class="contrib-row">
                   <span class="contrib-feature">${c.feature}</span>
                   <div class="contrib-bar-wrap"><div class="contrib-bar ${dir}" style="width:${pct}%"></div></div>
                   <span class="contrib-value">${Number(c.contribution) >= 0 ? '+' : ''}${Number(c.contribution).toFixed(1)}</span>
                 </div>`;
          }).join('')}
             </div>`
          : '';

        box.innerHTML = `
          <div style="font-size:0.75rem;font-weight:600;color:#2563eb;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <i class="fa-solid fa-upload"></i> Forecast from uploaded dataset (${rows.length} rows)
          </div>
          <div class="forecast-result-cards" style="grid-template-columns:1fr 1fr">
            <div class="result-card">
              <span class="result-label">Predicted Demand</span>
              <span class="result-value">${fmtNum(data.predicted_demand)}</span>
              <span class="result-unit">units</span>
            </div>
            <div class="result-card">
              <span class="result-label">Recommended Stock</span>
              <span class="result-value" style="color:#059669">${fmtNum(data.recommended_stock)}</span>
              <span class="result-unit">units (×1.15 buffer)</span>
            </div>
            <div class="result-card" style="grid-column:1/-1">
              <span class="result-label">90% Confidence Interval</span>
              <span style="font-size:0.88rem;font-weight:700;color:var(--text-muted)">
                [${fmtNum(pi.lower)} — ${fmtNum(pi.upper)}]
              </span>
            </div>
            ${mm.mae ? `<div class="result-card" style="grid-column:1/-1">
              <span class="result-label">Model Accuracy (Test Set)</span>
              <span style="font-size:0.82rem;font-weight:700;color:var(--accent)">
                MAE: ${Number(mm.mae).toFixed(1)} &nbsp;|&nbsp; MAPE: ${fmtPct(mm.mape)} &nbsp;|&nbsp; R²: ${Number(mm.r2 || 0).toFixed(3)}
              </span>
              <span class="result-unit" style="font-size:0.65rem">${mm.note || 'Chronological split — no data leakage'}</span>
            </div>` : ''}
          </div>
          ${contribHtml}`;
      }

      buildForecastPageChart({
        predicted: data.predicted_demand,
        interval: data.prediction_interval,
        history: rows,
      });
      showToast(`✓ Model predicts ${fmtNum(data.predicted_demand)} units demand`);

    } catch (err) {
      hideLoading();
      if (msg) { msg.className = 'validation-msg error'; msg.textContent = `✗ Forecast failed: ${err.message}. Make sure the backend is running on port 4000.`; }
      showToast('Forecast failed — check backend connection');
    } finally {
      if (startBtn) { startBtn.disabled = false; startBtn.style.opacity = '1'; }
    }
  });

  /* ML page */
  document.getElementById('mlDaysSlider')?.addEventListener('input', function () {
    const el = document.getElementById('mlDaysLabel'); if (el) el.textContent = this.value;
  });
  document.getElementById('mlLinearBtn')?.addEventListener('click', () => runMlTraining('Linear Regression'));
  document.getElementById('mlForestBtn')?.addEventListener('click', () => runMlTraining('Random Forest'));
  document.getElementById('mlAddRow')?.addEventListener('click', mlAddRow);

  /* Global search */
  initGlobalSearch();

  /* Boot dashboard after validating the session and applying its role. */
  loadCurrentUser().then(valid => {
    if (!valid) return;
    const rolePage = currentUser.role === 'PROCUREMENT' ? 'procurement' : currentUser.role === 'WAREHOUSE' ? 'warehouse' : 'dashboard';
    navigateTo(rolePage);
  });
});
