'use strict';

const express = require('express');
const db = require('../db');
const { authorize } = require('../middleware/auth');

const router = express.Router();
const PROCUREMENT_ROLES = ['ADMIN', 'PROCUREMENT'];
const OPERATIONS_ROLES = ['ADMIN', 'PROCUREMENT', 'WAREHOUSE'];

router.use((req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    next();
});

function requestForUser(request) {
    return { ...request, approvedByName: db.findUserById(request.approvedBy)?.name || request.approvedBy || '—' };
}

router.get('/dashboard', authorize(...OPERATIONS_ROLES), (req, res) => {
    const requests = db.listPurchaseRequests();
    const orders = db.listPurchaseOrders();
    const receipts = db.listGoodsReceipts();
    const today = new Date().toISOString().slice(0, 10);
    const value = orders.reduce((total, order) => total + Number(order.totalAmount || 0), 0);
    res.json({
        pendingRequests: requests.filter(item => item.status === 'PENDING').length,
        approvedRequests: requests.filter(item => item.status === 'APPROVED').length,
        purchaseOrders: orders.length,
        awaitingSupplier: orders.filter(item => ['PURCHASE_ORDER_CREATED', 'ORDERED'].includes(item.status)).length,
        inTransit: orders.filter(item => item.status === 'IN_TRANSIT').length,
        expectedDeliveries: orders.filter(item => item.expectedDelivery === today).length,
        completedOrders: orders.filter(item => item.status === 'COMPLETED').length,
        totalProcurementValue: value,
        pendingReceipts: orders.filter(item => ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(item.status)).length,
        todaysExpectedDeliveries: orders.filter(item => item.expectedDelivery === today).length,
        receivedToday: receipts.filter(item => String(item.receivedAt || '').slice(0, 10) === today).length,
        damagedShortDeliveries: receipts.filter(item => Number(item.damagedQuantity) > 0 || Number(item.shortQuantity) > 0).length,
        completedReceipts: receipts.filter(item => item.status === 'COMPLETED').length,
    });
});

router.get('/purchase-requests', authorize(...PROCUREMENT_ROLES), (req, res) => {
    const requests = db.listPurchaseRequests().filter(item => req.user.role === 'ADMIN' || !['REJECTED', 'SNOOZED'].includes(item.status));
    res.json({ requests: requests.map(requestForUser) });
});

router.get('/purchase-orders', authorize(...OPERATIONS_ROLES), (req, res) => {
    res.json({ orders: db.listPurchaseOrders().map(order => ({ ...order, supplier: db.listSuppliers().find(item => item.id === order.supplierId) || null })) });
});

router.get('/purchase-orders/:id', authorize(...OPERATIONS_ROLES), (req, res) => {
    const order = db.listPurchaseOrders().find(item => item.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Purchase Order could not be found.' });
    const supplier = db.listSuppliers().find(item => item.id === order.supplierId) || null;
    const request = db.listPurchaseRequests().find(item => item.id === order.purchaseRequestId) || null;
    res.json({ order: { ...order, supplier, purchaseRequest: request } });
});

router.get('/suppliers', authorize(...PROCUREMENT_ROLES), (req, res) => {
    res.json({ suppliers: db.listSuppliers() });
});

router.post('/suppliers', authorize(...PROCUREMENT_ROLES), (req, res) => {
    const { name, contactPerson, email, phone, address, products, leadTime, status } = req.body;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Supplier name is required.' });
    res.status(201).json({ supplier: db.insertSupplier({ userId: req.user.id, name: String(name).trim(), contactPerson, email, phone, address, products, leadTime, status }) });
});

router.patch('/suppliers/:id', authorize(...PROCUREMENT_ROLES), (req, res) => {
    const allowed = ['name', 'contactPerson', 'email', 'phone', 'address', 'products', 'leadTime', 'status'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    if (updates.leadTime !== undefined) updates.leadTime = Number(updates.leadTime);
    const supplier = db.updateSupplier(req.params.id, undefined, updates);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found.' });
    res.json({ supplier });
});

router.post('/purchase-orders', authorize(...PROCUREMENT_ROLES), (req, res) => {
    const { purchaseRequestId, supplierId, quantity, unitPrice, expectedDelivery, leadTime } = req.body;
    const request = db.listPurchaseRequests().find(item => item.id === purchaseRequestId);
    const supplier = db.listSuppliers().find(item => item.id === supplierId);
    const orderQuantity = Number(quantity);
    const price = Number(unitPrice);
    if (!request) return res.status(404).json({ error: 'Purchase Request not found.' });
    if (request.purchaseOrderId) {
        const linkedOrder = db.listPurchaseOrders().find(item => item.id === request.purchaseOrderId);
        if (!linkedOrder) return res.status(409).json({ error: 'Purchase Request references a missing Purchase Order.' });
        return res.json({ order: linkedOrder, existing: true });
    }
    const existingOrder = db.listPurchaseOrders().find(item => item.purchaseRequestId === request.id && item.status !== 'CANCELLED');
    if (existingOrder) {
        db.updatePurchaseRequest(request.id, { purchaseOrderId: existingOrder.id, status: 'PURCHASE_ORDER_CREATED' });
        return res.json({ order: existingOrder, existing: true });
    }
    if (request.status !== 'APPROVED') return res.status(400).json({ error: 'Purchase Request is not approved.' });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found.' });
    if (supplier.status !== 'ACTIVE') return res.status(400).json({ error: 'Supplier is inactive.' });
    if (!Number.isFinite(orderQuantity) || orderQuantity <= 0) return res.status(400).json({ error: 'Quantity is required and must be greater than zero.' });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Unit price is required and must be non-negative.' });
    if (!expectedDelivery) return res.status(400).json({ error: 'Expected delivery date is required.' });
    const order = db.insertPurchaseOrder({
        purchaseRequestId, ownerUserId: request.ownerUserId, supplierId, product: request.product, productId: request.productId,
        category: request.category, quantity: orderQuantity, expectedQuantity: orderQuantity, unitPrice: price,
        totalAmount: orderQuantity * price, expectedDelivery, leadTime: Number(leadTime || supplier.leadTime || 0), createdBy: req.user.id,
    });
    db.updatePurchaseRequest(request.id, { status: 'PURCHASE_ORDER_CREATED', purchaseOrderId: order.id });
    res.status(201).json({ order });
});

router.patch('/purchase-orders/:id/status', authorize('ADMIN', 'PROCUREMENT', 'WAREHOUSE'), (req, res) => {
    const transitions = {
        DRAFT: ['SUBMITTED', 'CANCELLED'],
        PURCHASE_ORDER_CREATED: ['ORDERED', 'CANCELLED'],
        ORDERED: ['IN_TRANSIT', 'CANCELLED'],
        IN_TRANSIT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'DELIVERED', 'CANCELLED'],
        PARTIALLY_RECEIVED: ['RECEIVED', 'COMPLETED'],
        RECEIVED: ['COMPLETED'],
    };
    const nextStatus = String(req.body.status || '').toUpperCase();
    if (!['DRAFT', 'SUBMITTED', 'PURCHASE_ORDER_CREATED', 'ORDERED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'DELIVERED', 'COMPLETED', 'CANCELLED'].includes(nextStatus)) return res.status(400).json({ error: 'Invalid Purchase Order status.' });
    const currentOrder = db.listPurchaseOrders().find(item => item.id === req.params.id);
    if (!currentOrder) return res.status(404).json({ error: 'Purchase Order not found.' });
    const procurementStatuses = ['SUBMITTED', 'ORDERED', 'IN_TRANSIT', 'CANCELLED'];
    const warehouseStatuses = ['PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED'];
    if (req.user.role === 'PROCUREMENT' && !procurementStatuses.includes(nextStatus)) return res.status(403).json({ error: 'Not authorized to update Purchase Orders.' });
    if (req.user.role === 'WAREHOUSE' && !warehouseStatuses.includes(nextStatus)) return res.status(403).json({ error: 'Not authorized to update Purchase Orders.' });
    if (!transitions[currentOrder.status]?.includes(nextStatus)) return res.status(409).json({ error: `Invalid purchase order status transition from ${currentOrder.status} to ${nextStatus}.` });
    const statusHistory = [...(currentOrder.statusHistory || []), { previousStatus: currentOrder.status, newStatus: nextStatus, changedBy: req.user.id, changedAt: new Date().toISOString() }];
    const order = db.updatePurchaseOrder(req.params.id, { status: nextStatus, statusHistory, ...(req.body.expectedDelivery ? { expectedDelivery: req.body.expectedDelivery } : {}) });
    res.json({ order });
});

router.get('/receipts', authorize(...OPERATIONS_ROLES), (req, res) => {
    res.json({ receipts: db.listGoodsReceipts() });
});

router.get('/inventory-transactions', authorize(...OPERATIONS_ROLES), (req, res) => {
    res.json({ transactions: db.listInventoryTransactions() });
});

router.post('/purchase-orders/:id/receive', authorize('ADMIN', 'WAREHOUSE'), (req, res) => {
    const order = db.listPurchaseOrders().find(item => item.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Purchase order not found.' });
    if (['CANCELLED', 'COMPLETED'].includes(order.status)) return res.status(400).json({ error: 'This purchase order cannot receive goods.' });
    const receivedQuantity = Number(req.body.receivedQuantity);
    const damagedQuantity = Number(req.body.damagedQuantity || 0);
    const shortQuantity = Number(req.body.shortQuantity || 0);
    if (![receivedQuantity, damagedQuantity, shortQuantity].every(Number.isInteger) || receivedQuantity < 0 || damagedQuantity < 0 || shortQuantity < 0) return res.status(400).json({ error: 'Receipt quantities must be non-negative whole numbers.' });
    const receivedSoFar = db.listGoodsReceipts().filter(item => item.purchaseOrderId === order.id).reduce((total, item) => total + Number(item.receivedQuantity || 0), 0);
    if (receivedSoFar + receivedQuantity > Number(order.quantity)) return res.status(400).json({ error: 'Received quantity cannot exceed the ordered quantity.' });
    if (receivedQuantity + damagedQuantity + shortQuantity > Number(order.quantity) - receivedSoFar) return res.status(400).json({ error: 'Received, damaged, and short quantities exceed the outstanding quantity.' });
    const receipt = db.insertGoodsReceipt({ purchaseOrderId: order.id, poNumber: order.poNumber, product: order.product, receivedQuantity, damagedQuantity, shortQuantity, notes: String(req.body.notes || ''), warehouseUserId: req.user.id, status: receivedQuantity + damagedQuantity + shortQuantity === Number(order.quantity) - receivedSoFar ? 'COMPLETED' : 'PARTIALLY_RECEIVED' });
    if (receivedQuantity > 0) {
        const inventory = db.updateProductInventory(order.ownerUserId, order.product, receivedQuantity);
        if (!inventory) return res.status(422).json({ error: 'Goods were recorded, but the owning inventory dataset could not be updated.' });
        db.insertInventoryTransaction({ product: order.product, quantity: receivedQuantity, transactionType: 'RECEIPT', purchaseOrderId: order.id, warehouseUserId: req.user.id, notes: receipt.notes, inventoryAfter: inventory.inventory });
    }
    const allReceipts = db.listGoodsReceipts().filter(item => item.purchaseOrderId === order.id);
    const totalReceived = allReceipts.reduce((total, item) => total + Number(item.receivedQuantity || 0), 0);
    const totalAccounted = allReceipts.reduce((total, item) => total + Number(item.receivedQuantity || 0) + Number(item.damagedQuantity || 0) + Number(item.shortQuantity || 0), 0);
    const status = totalAccounted >= Number(order.quantity) && totalReceived >= Number(order.quantity) ? 'COMPLETED' : totalReceived > 0 ? 'PARTIALLY_RECEIVED' : 'IN_TRANSIT';
    db.updatePurchaseOrder(order.id, { status, receivedQuantity: totalReceived, remainingQuantity: Math.max(0, Number(order.quantity) - totalReceived) });
    db.updatePurchaseRequest(order.purchaseRequestId, { status: status === 'COMPLETED' ? 'COMPLETED' : status });
    res.status(201).json({ receipt, order: db.listPurchaseOrders().find(item => item.id === order.id), inventoryTransaction: receivedQuantity > 0 ? 'RECORDED' : null });
});

module.exports = router;
