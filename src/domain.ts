import { randomUUID } from 'node:crypto';

export type OrderStatus = 'draft' | 'confirmed' | 'allocated' | 'dispatched' | 'delivered' | 'closed' | 'cancelled';
export type CustomsStatus = 'draft' | 'submitted' | 'inspection' | 'cleared' | 'rejected';
export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'void';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

type Tenant = { id: string; name: string; creditLimit: number; creditUsed: number; currency: string };
type Customer = { id: string; tenantId: string; name: string; creditLimit: number; creditUsed: number; blocked: boolean; timezone?: string };
type OrderItem = { sku: string; description: string; quantity: number; unitPrice: number; weightKg: number; hsCode: string };
export type Order = { id: string; tenantId: string; customerId: string; reference: string; origin: string; destination: string; priority: 'standard' | 'urgent' | 'critical'; status: OrderStatus; items: OrderItem[]; totalWeightKg: number; subtotal: number; totalAmount: number; currency: string; version: number; shipmentId?: string; customsDeclarationId?: string; invoiceId?: string; createdAt: string; updatedAt: string };
type InventoryLot = { id: string; tenantId: string; warehouse: string; sku: string; available: number; reserved: number; lotCode: string; expiresAt?: string };
type Reservation = { id: string; tenantId: string; orderId: string; lotId: string; sku: string; quantity: number; status: 'active' | 'released' | 'consumed'; createdAt: string };
type ShipmentLeg = { id: string; mode: 'truck' | 'rail' | 'sea' | 'air'; origin: string; destination: string; plannedDeparture: string; plannedArrival: string; actualArrival?: string; status: 'planned' | 'in_transit' | 'arrived' | 'delayed' };
type Shipment = { id: string; tenantId: string; orderId: string; trackingNo: string; legs: ShipmentLeg[]; currentLocation: string; eta: string; status: 'planned' | 'in_transit' | 'delivered' | 'exception'; events: { id: string; code: string; location: string; occurredAt: string; note?: string }[] };
type CustomsDeclaration = { id: string; tenantId: string; orderId: string; country: string; status: CustomsStatus; documentRefs: string[]; requiredDocuments: string[]; riskScore: number; rejectionReason?: string; updatedAt: string };
type InvoiceLine = { code: string; description: string; quantity: number; unitPrice: number; amount: number };
type Invoice = { id: string; tenantId: string; orderId: string; number: string; status: InvoiceStatus; currency: string; lines: InvoiceLine[]; subtotal: number; tax: number; total: number; paid: number; dueDate: string; createdAt: string };
// 第三方支付渠道：银行转账、卡组织、清算服务。渠道与租户、第三方流水号共同构成幂等边界。
export type PaymentChannel = 'bank_transfer' | 'card' | 'clearing' | 'credit_note';
export type PaymentStatus = 'succeeded' | 'failed';
export type Payment = { id: string; tenantId: string; invoiceId: string; orderId: string; channel: PaymentChannel; reference: string; amount: number; currency: string; status: PaymentStatus; failureReason?: string; idempotencyKey: string; receivedAt: string };
// 幂等登记：同一 (tenantId, channel, reference) 全局唯一，指向唯一一笔 payment。
type PaymentIdempotencyRecord = { key: string; tenantId: string; channel: PaymentChannel; reference: string; paymentId: string; invoiceId: string };
export type PaymentCallbackOutcome = 'recorded' | 'duplicate' | 'late_failure_ignored';
export type PaymentCallbackResult = { payment: Payment; outcome: PaymentCallbackOutcome; duplicate: boolean };
// 回调被拒绝时抛出，携带 HTTP 语义供接入层映射（409=幂等冲突，422=业务校验拒绝）。
export class PaymentCallbackError extends Error { statusCode: number; constructor(statusCode: number, message: string) { super(message); this.name = 'PaymentCallbackError'; this.statusCode = statusCode; } }
export type PaymentCallbackInput = { invoiceId: string; amount: number; channel?: PaymentChannel; /** 兼容旧字段 method，channel 缺省时取它 */ method?: Payment['channel']; reference: string; currency?: string; status?: PaymentStatus; failureReason?: string };
type Approval = { id: string; tenantId: string; orderId: string; type: 'credit_override' | 'customs_exception' | 'delay_compensation'; reason: string; status: ApprovalStatus; decidedBy?: string; comment?: string; createdAt: string; decidedAt?: string };
export type AuditEvent = { id: string; tenantId: string; actor: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; at: string };
export type OutboxEvent = { id: string; tenantId: string; topic: string; aggregateId: string; payload: unknown; status: 'pending' | 'published'; attempts: number; createdAt: string };

type State = { tenants: Tenant[]; customers: Customer[]; orders: Order[]; inventory: InventoryLot[]; reservations: Reservation[]; shipments: Shipment[]; customs: CustomsDeclaration[]; invoices: Invoice[]; payments: Payment[]; paymentIdempotency: Map<string, PaymentIdempotencyRecord>; approvals: Approval[]; audit: AuditEvent[]; outbox: OutboxEvent[] };
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
const money = (value: number) => Math.round(value * 100) / 100;
// 金额比较容忍 1 美分误差，避免浮点导致的重复入账或越余额核销。
const CENT = 0.01;
const sameMoney = (a: number, b: number) => Math.abs(a - b) <= CENT;
const paymentKey = (tenantId: string, channel: PaymentChannel, reference: string) => `${tenantId}|${channel}|${reference}`;

export const state: State = {
  tenants: [{ id: 'tenant-acme', name: 'Acme Global Trading', creditLimit: 250000, creditUsed: 36200, currency: 'USD' }],
  customers: [{ id: 'CUS-001', tenantId: 'tenant-acme', name: 'Northstar Retail GmbH', creditLimit: 100000, creditUsed: 12000, blocked: false, timezone: 'Europe/Berlin' }, { id: 'CUS-002', tenantId: 'tenant-acme', name: 'Pacific Parts Inc.', creditLimit: 50000, creditUsed: 49000, blocked: false, timezone: 'America/Los_Angeles' }],
  orders: [], inventory: [
    { id: 'LOT-001', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'SENSOR-X9', available: 80, reserved: 10, lotCode: 'SX9-2608' },
    { id: 'LOT-002', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'CONTROL-M2', available: 36, reserved: 4, lotCode: 'CM2-2607' },
    { id: 'LOT-003', tenantId: 'tenant-acme', warehouse: 'ROTTERDAM-DC', sku: 'SENSOR-X9', available: 12, reserved: 0, lotCode: 'SX9-2606' }
  ], reservations: [], shipments: [], customs: [], invoices: [], payments: [], paymentIdempotency: new Map(), approvals: [], audit: [], outbox: []
};

function tenant(id: string) { const value = state.tenants.find(item => item.id === id); if (!value) throw new Error('租户不存在'); return value; }
function assertTenant<T extends { tenantId: string }>(item: T, tenantId: string) { if (item.tenantId !== tenantId) throw new Error('无权访问其他租户的数据'); return item; }
function customerFor(tenantId: string, customerId: string) { const customer = state.customers.find(item => item.id === customerId && item.tenantId === tenantId); if (!customer) throw new Error('客户不存在'); return customer; }
function orderFor(tenantId: string, orderId: string) { const order = state.orders.find(item => item.id === orderId); if (!order) throw new Error('订单不存在'); return assertTenant(order, tenantId); }
function record(tenantId: string, actor: string, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) { state.audit.unshift({ id: id('AUD'), tenantId, actor, action, entityType, entityId, before: before === undefined ? undefined : clone(before), after: after === undefined ? undefined : clone(after), at: now() }); }
function emit(tenantId: string, topic: string, aggregateId: string, payload: unknown) { state.outbox.unshift({ id: id('EVT'), tenantId, topic, aggregateId, payload: clone(payload), status: 'pending', attempts: 0, createdAt: now() }); }
function mutate(tenantId: string, actor: string, action: string, type: string, entityId: string, before: unknown, after: unknown, topic: string) { record(tenantId, actor, action, type, entityId, before, after); if (action !== 'order.confirmed') emit(tenantId, topic, entityId, after); }
function transition(order: Order, next: OrderStatus) { const allowed: Record<OrderStatus, OrderStatus[]> = { draft: ['confirmed', 'cancelled'], confirmed: ['allocated', 'cancelled'], allocated: ['dispatched', 'cancelled'], dispatched: ['delivered'], delivered: ['closed', 'dispatched'], closed: [], cancelled: [] }; if (!allowed[order.status].includes(next)) throw new Error(`订单不能从 ${order.status} 变更为 ${next}`); order.status = next; order.version += 1; order.updatedAt = now(); }

export function listOrders(tenantId: string, filters: { status?: string; customerId?: string; q?: string } = {}) { tenant(tenantId); return state.orders.filter(item => item.tenantId === tenantId && (!filters.status || item.status === filters.status) && (!filters.customerId || item.customerId === filters.customerId) && (!filters.q || `${item.reference} ${item.destination}`.toLowerCase().includes(filters.q.toLowerCase()))).map(clone); }
export function getOrder(tenantId: string, orderId: string) { return clone(orderFor(tenantId, orderId)); }
export function createOrder(tenantId: string, input: Partial<Order>, actor = 'system') {
  tenant(tenantId); if (!input.customerId || !input.reference || !input.origin || !input.destination || !input.items?.length) throw new Error('客户、参考号、起讫地和订单明细均不能为空');
  if (state.orders.some(item => item.reference === input.reference)) throw new Error('客户参考号已存在');
  const items = input.items.map(item => { if (!item.sku || !item.quantity || item.quantity <= 0 || !item.unitPrice || item.unitPrice < 0 || !item.weightKg || item.weightKg <= 0) throw new Error('订单明细数量、价格和重量必须为正数'); return { sku: item.sku, description: item.description ?? item.sku, quantity: item.quantity, unitPrice: item.unitPrice, weightKg: item.weightKg, hsCode: item.hsCode ?? '0000.00' }; });
  const subtotal = money(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)); const order: Order = { id: id('ORD'), tenantId, customerId: input.customerId, reference: input.reference, origin: input.origin, destination: input.destination, priority: input.priority ?? 'standard', status: 'draft', items, totalWeightKg: money(items.reduce((sum, item) => sum + item.quantity * item.weightKg, 0)), subtotal, totalAmount: subtotal, currency: input.currency ?? tenant(tenantId).currency, version: 1, createdAt: now(), updatedAt: now() };
  state.orders.unshift(order); mutate(tenantId, actor, 'order.created', 'order', order.id, undefined, order, 'order.created'); return clone(order);
}
export function confirmOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const before = clone(order); const customer = customerFor(tenantId, order.customerId); if (customer.blocked) throw new Error('客户已被风控冻结'); if (customer.creditUsed + order.totalAmount > customer.creditLimit) { const approval = createApproval(tenantId, { orderId, type: 'credit_override', reason: '订单金额超过客户授信额度' }, actor); throw new Error(`客户授信不足，需要审批 ${approval.id}`); } transition(order, 'confirmed'); customer.creditUsed = money(customer.creditUsed + order.totalAmount); mutate(tenantId, actor, 'order.confirmed', 'order', order.id, before, order, 'order.confirmed'); return clone(order); }
export function allocateOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const before = clone(order); const allocations: Reservation[] = []; for (const item of order.items) { let remaining = item.quantity; for (const lot of state.inventory.filter(value => value.tenantId === tenantId && value.sku === item.sku && value.available - value.reserved > 0)) { const qty = Math.min(remaining, lot.available); lot.reserved += qty; remaining -= qty; allocations.push({ id: id('RSV'), tenantId, orderId, lotId: lot.id, sku: item.sku, quantity: qty, status: 'active', createdAt: now() }); if (!remaining) break; } if (remaining) { for (const allocation of allocations) { const lot = state.inventory.find(value => value.id === allocation.lotId)!; lot.reserved -= allocation.quantity; } throw new Error(`库存不足：${item.sku} 还缺少 ${remaining}`); } } state.reservations.push(...allocations); transition(order, 'allocated'); mutate(tenantId, actor, 'order.allocated', 'order', order.id, before, { order, allocations }, 'inventory.reserved'); return clone(order); }
export function dispatchOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const customs = state.customs.find(item => item.orderId === orderId); if (!customs || customs.status !== 'cleared') throw new Error('海关申报尚未放行'); const reservations = state.reservations.filter(item => item.orderId === orderId && item.status === 'active'); if (!reservations.length) throw new Error('订单没有有效库存分配'); const before = clone(order); transition(order, 'dispatched'); reservations.forEach(reservation => { const lot = state.inventory.find(item => item.id === reservation.lotId)!; lot.available -= reservation.quantity; lot.reserved -= reservation.quantity; reservation.status = 'consumed'; }); const shipment: Shipment = { id: id('SHP'), tenantId, orderId, trackingNo: `CBF${Date.now().toString().slice(-8)}`, legs: [{ id: id('LEG'), mode: 'truck', origin: order.origin, destination: '出口口岸', plannedDeparture: now(), plannedArrival: new Date(Date.now() + 86400000).toISOString(), status: 'planned' }, { id: id('LEG'), mode: 'sea', origin: '出口口岸', destination: order.destination, plannedDeparture: new Date(Date.now() + 172800000).toISOString(), plannedArrival: new Date(Date.now() + 10 * 86400000).toISOString(), status: 'planned' }], currentLocation: order.origin, eta: new Date(Date.now() + 10 * 86400000).toISOString(), status: 'planned', events: [] }; state.shipments.push(shipment); order.shipmentId = shipment.id; mutate(tenantId, actor, 'order.dispatched', 'order', order.id, before, { order, shipment }, 'shipment.created'); return clone(order); }
export function deliverOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const shipment = state.shipments.find(item => item.orderId === orderId); if (!shipment) throw new Error('运输单不存在'); const before = clone(order); transition(order, 'delivered'); shipment.status = 'delivered'; shipment.currentLocation = order.destination; shipment.events.push({ id: id('TRK'), code: 'DELIVERED', location: order.destination, occurredAt: now(), note: '签收完成' }); mutate(tenantId, actor, 'order.delivered', 'order', order.id, before, { order, shipment }, 'shipment.delivered'); return clone(order); }
export function closeOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); if (order.status === 'closed') return clone(order); const invoice = state.invoices.find(item => item.orderId === orderId); if (!invoice || invoice.status !== 'paid') throw new Error('发票未完成收款核销'); const before = clone(order); transition(order, 'closed'); const customer = customerFor(tenantId, order.customerId); customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount)); mutate(tenantId, actor, 'order.closed', 'order', order.id, before, order, 'order.closed'); return clone(order); }
export function cancelOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const before = clone(order); if (['dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('已出运订单不能取消'); transition(order, 'cancelled'); const reservation = state.reservations.find(item => item.orderId === orderId && item.status === 'active'); if (reservation) { state.inventory.find(lot => lot.id === reservation.lotId)!.reserved -= reservation.quantity; reservation.status = 'released'; } const customer = customerFor(tenantId, order.customerId); if (before.status !== 'draft') customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount)); mutate(tenantId, actor, 'order.cancelled', 'order', order.id, before, order, 'order.cancelled'); return clone(order); }

export function createCustomsDeclaration(tenantId: string, input: { orderId: string; country?: string; requiredDocuments?: string[] }, actor = 'system') { const order = orderFor(tenantId, input.orderId); if (state.customs.some(item => item.orderId === order.id)) throw new Error('订单已有海关申报'); const declaration: CustomsDeclaration = { id: id('CUS'), tenantId, orderId: order.id, country: input.country ?? order.destination, status: 'draft', documentRefs: [], requiredDocuments: input.requiredDocuments ?? ['commercial-invoice', 'packing-list', 'origin-certificate'], riskScore: order.priority === 'critical' ? 82 : order.totalWeightKg > 1000 ? 60 : 24, updatedAt: now() }; state.customs.push(declaration); order.customsDeclarationId = declaration.id; mutate(tenantId, actor, 'customs.created', 'customs', declaration.id, undefined, declaration, 'customs.created'); return clone(declaration); }
export function updateCustoms(tenantId: string, declarationId: string, input: { status?: CustomsStatus; documentRefs?: string[]; rejectionReason?: string }, actor = 'system') { const declaration = assertTenant(state.customs.find(item => item.id === declarationId) ?? (() => { throw new Error('海关申报不存在'); })(), tenantId); const before = clone(declaration); if (input.documentRefs) declaration.documentRefs = [...new Set(input.documentRefs)]; if (input.status) { if (input.status === 'cleared' && declaration.requiredDocuments.some(doc => !declaration.documentRefs.includes(doc))) throw new Error('放行前必须补齐所有必需单证'); if (input.status === 'inspection' && declaration.status !== 'submitted') throw new Error('只有已提交申报才能进入查验'); declaration.status = input.status; } declaration.rejectionReason = input.rejectionReason; declaration.updatedAt = now(); mutate(tenantId, actor, 'customs.updated', 'customs', declaration.id, before, declaration, 'customs.updated'); return clone(declaration); }
export function addShipmentEvent(tenantId: string, shipmentId: string, input: { code: string; location: string; occurredAt?: string; note?: string }, actor = 'system') { const shipment = assertTenant(state.shipments.find(item => item.id === shipmentId) ?? (() => { throw new Error('运输单不存在'); })(), tenantId); if (!input.code || !input.location) throw new Error('轨迹编码和位置不能为空'); const event = { id: id('TRK'), code: input.code, location: input.location, occurredAt: input.occurredAt ?? now(), note: input.note }; shipment.events.push(event); shipment.currentLocation = input.location; if (input.code === 'DEPARTED') { shipment.status = 'in_transit'; shipment.legs[0].status = 'in_transit'; } if (input.code === 'DELAYED') { shipment.status = 'exception'; shipment.legs.find(leg => leg.status !== 'arrived')!.status = 'delayed'; createApproval(tenantId, { orderId: shipment.orderId, type: 'delay_compensation', reason: `运输轨迹 ${shipment.trackingNo} 发生延误` }, actor); } if (input.code === 'ARRIVED') shipment.legs[shipment.legs.length - 1].status = 'arrived'; record(tenantId, actor, 'shipment.event.added', 'shipment', shipment.id, undefined, event); emit(tenantId, 'shipment.event.added', shipment.id, event); return clone(shipment); }

export function generateInvoice(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const existing = state.invoices.find(item => item.orderId === orderId); if (existing) return clone(existing); if (!['allocated', 'dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('订单完成库存分配后才能开票'); const freight = money(Math.max(120, order.totalWeightKg * (order.priority === 'critical' ? 4.2 : 2.1))); const fuel = money(freight * 0.13); const customsFee = money(95 + order.items.length * 25); const lines: InvoiceLine[] = [{ code: 'GOODS', description: '货物服务费', quantity: 1, unitPrice: order.subtotal, amount: order.subtotal }, { code: 'FREIGHT', description: '跨境运输费', quantity: 1, unitPrice: freight, amount: freight }, { code: 'FUEL', description: '燃油附加费', quantity: 1, unitPrice: fuel, amount: fuel }, { code: 'CUSTOMS', description: '关务服务费', quantity: 1, unitPrice: customsFee, amount: customsFee }]; const subtotal = money(lines.reduce((sum, line) => sum + line.amount, 0)); const tax = money(subtotal * 0.06); const invoice: Invoice = { id: id('INV'), tenantId, orderId, number: `INV-${new Date().getFullYear()}-${String(state.invoices.length + 1).padStart(5, '0')}`, status: 'issued', currency: order.currency, lines, subtotal, tax, total: money(subtotal + tax), paid: 0, dueDate: new Date(Date.now() + 30 * 86400000).toISOString(), createdAt: now() }; state.invoices.push(invoice); order.invoiceId = invoice.id; mutate(tenantId, actor, 'invoice.issued', 'invoice', invoice.id, undefined, invoice, 'invoice.issued'); return clone(invoice); }
// 支付回调幂等入账核心。
// 幂等边界：(tenantId, channel, reference) —— 租户 × 支付渠道 × 第三方流水号。
// - 相同流水号且业务内容（发票、金额、币种）一致：返回同一笔 payment，绝不重复记账。
// - 相同流水号但业务内容不一致：拒绝并记录 payment.conflict 冲突审计。
// - 晚到的失败通知不会回退已成功入账的 payment，只记录 payment.failure.late 审计。
// 该函数本身是同步的；在单线程事件循环中，从"查登记"到"写登记"之间没有 await，
// 因此天然串行。为防止未来在锁内加入异步步骤导致并发穿透，handlePaymentCallback
// 另外按幂等键加了进程内互斥队列。
export function processPaymentCallback(tenantId: string, input: PaymentCallbackInput, actor = 'system'): PaymentCallbackResult {
  tenant(tenantId);
  const reference = String(input.reference ?? '').trim();
  const channel = (input.channel ?? input.method) as PaymentChannel | undefined;
  if (!reference) throw new PaymentCallbackError(422, '第三方流水号不能为空');
  if (!channel || !['bank_transfer', 'card', 'clearing', 'credit_note'].includes(channel)) throw new PaymentCallbackError(422, '支付渠道不合法');
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) throw new PaymentCallbackError(422, '收款金额必须为正数');
  if (!input.invoiceId) throw new PaymentCallbackError(422, '发票不能为空');
  const amount = money(input.amount);
  const status: PaymentStatus = input.status === 'failed' ? 'failed' : 'succeeded';
  const key = paymentKey(tenantId, channel, reference);

  // 1) 先查幂等登记：重复回调直接返回既有结果，不触碰 invoice/audit/outbox。
  const existingRecord = state.paymentIdempotency.get(key);
  if (existingRecord) {
    const existing = state.payments.find(item => item.id === existingRecord.paymentId)!;
    // 业务内容一致性校验（币种缺省时以发票币种为准，不视为冲突）。
    const invoice = state.invoices.find(item => item.id === existing.invoiceId);
    const expectedCurrency = invoice?.currency;
    if (existing.invoiceId !== input.invoiceId
      || !sameMoney(existing.amount, amount)
      || (input.currency && expectedCurrency && input.currency !== expectedCurrency)
      || (input.currency && existing.currency && input.currency !== existing.currency)) {
      const conflict = { reason: '第三方流水号已用于不同的业务内容', key, existingPayment: { paymentId: existing.id, invoiceId: existing.invoiceId, amount: existing.amount, currency: existing.currency, status: existing.status }, incoming: { invoiceId: input.invoiceId, amount, currency: input.currency ?? null, status } };
      record(tenantId, actor, 'payment.conflict', 'invoice', existing.invoiceId, conflict, undefined);
      throw new PaymentCallbackError(409, `流水号 ${reference} 已存在且业务内容不一致，已拒绝并记录冲突审计`);
    }
    if (existing.status !== status) {
      // 同一流水号状态翻转（先失败后成功 / 先成功后失败）：不能覆盖既有终态。
      const conflict = { reason: '第三方流水号回调状态与既有终态不一致', key, existingStatus: existing.status, incomingStatus: status };
      record(tenantId, actor, 'payment.conflict', 'invoice', existing.invoiceId, conflict, undefined);
      if (existing.status === 'succeeded' && status === 'failed') {
        // 晚到的失败通知：成功已入账，绝不退款、绝不回退订单状态。
        record(tenantId, actor, 'payment.failure.late', 'invoice', existing.invoiceId, { paymentId: existing.id, reference, channel, failureReason: input.failureReason ?? null, note: '成功入账后到达的失败通知，仅审计不执行退款' }, undefined);
        return { payment: clone(existing), outcome: 'late_failure_ignored', duplicate: true };
      }
      throw new PaymentCallbackError(409, `流水号 ${reference} 已登记为 ${existing.status}，不能改写为 ${status}；渠道恢复请使用新流水号`);
    }
    // 内容一致的重复回调（成功重试、失败重试）：原样返回同一结果。
    return { payment: clone(existing), outcome: 'duplicate', duplicate: true };
  }

  // 2) 新流水号：先完成所有业务校验，再落 payment 与幂等登记（校验失败不留脏数据）。
  const invoice = state.invoices.find(item => item.id === input.invoiceId);
  if (!invoice || invoice.tenantId !== tenantId) throw new PaymentCallbackError(422, '发票不存在');
  const order = state.orders.find(item => item.id === invoice.orderId);
  if (!order || order.tenantId !== tenantId) throw new PaymentCallbackError(422, '发票对应的订单不存在');
  const currency = input.currency ?? invoice.currency;
  if (currency !== invoice.currency) {
    rejectPayment(tenantId, actor, key, input.invoiceId, reference, channel, amount, currency, status, `回调币种 ${currency} 与发票币种 ${invoice.currency} 不一致`, 'payment.currency_mismatch', input.failureReason);
    throw new PaymentCallbackError(422, `回调币种 ${currency} 与发票币种 ${invoice.currency} 不一致`);
  }

  const paymentId = id('PAY');
  const receivedAt = now();
  if (status === 'failed') {
    // 失败通知本身不触碰发票余额，登记幂等键，防止随后的重复失败重复通知。
    const payment: Payment = { id: paymentId, tenantId, invoiceId: invoice.id, orderId: order.id, channel, reference, amount, currency, status: 'failed', failureReason: input.failureReason ?? '渠道通知失败', idempotencyKey: key, receivedAt };
    state.payments.unshift(payment);
    state.paymentIdempotency.set(key, { key, tenantId, channel, reference, paymentId, invoiceId: invoice.id });
    record(tenantId, actor, 'payment.failed', 'invoice', invoice.id, undefined, { payment: clone(payment) });
    emit(tenantId, 'payment.failed', invoice.id, { paymentId: payment.id, invoiceId: invoice.id, orderId: order.id, channel, reference, amount, currency, reason: payment.failureReason });
    return { payment: clone(payment), outcome: 'recorded', duplicate: false };
  }

  // 成功回调的业务护栏：作废发票 / 已取消订单 / 已付清发票 / 超额支付一律拒绝。
  if (invoice.status === 'void') {
    rejectPayment(tenantId, actor, key, input.invoiceId, reference, channel, amount, currency, status, '发票已作废，不能收款入账', 'payment.invoice.void', input.failureReason);
    throw new PaymentCallbackError(422, '发票已作废，不能收款入账');
  }
  if (order.status === 'cancelled') {
    rejectPayment(tenantId, actor, key, input.invoiceId, reference, channel, amount, currency, status, '订单已取消，拒绝入账（需人工退款/冲正）', 'payment.order.cancelled', input.failureReason);
    throw new PaymentCallbackError(422, '订单已取消，支付回调不能入账');
  }
  const remaining = money(invoice.total - invoice.paid);
  if (sameMoney(remaining, 0) || remaining < 0) {
    rejectPayment(tenantId, actor, key, input.invoiceId, reference, channel, amount, currency, status, '发票已付清，拒绝重复入账', 'payment.invoice.settled', input.failureReason);
    throw new PaymentCallbackError(409, '发票已付清，该流水号无法再入账');
  }
  if (money(invoice.paid + amount) > invoice.total + CENT) {
    rejectPayment(tenantId, actor, key, input.invoiceId, reference, channel, amount, currency, status, `收款金额 ${amount} 超过发票未核销余额 ${remaining}`, 'payment.overpayment', input.failureReason);
    throw new PaymentCallbackError(422, `收款金额超过发票未核销余额（剩余 ${remaining}）`);
  }

  // 3) 提交：payment、幂等登记、发票核销、订单结算在同一同步临界区内完成。
  const payment: Payment = { id: paymentId, tenantId, invoiceId: invoice.id, orderId: order.id, channel, reference, amount, currency, status: 'succeeded', idempotencyKey: key, receivedAt };
  state.payments.unshift(payment);
  state.paymentIdempotency.set(key, { key, tenantId, channel, reference, paymentId, invoiceId: invoice.id });
  const before = clone(invoice);
  invoice.paid = money(invoice.paid + amount);
  invoice.status = invoice.paid >= invoice.total - CENT ? 'paid' : 'partially_paid';
  let orderSettled = false;
  if (invoice.status === 'paid') orderSettled = settlePaidOrder(order, invoice);
  mutate(tenantId, actor, 'payment.recorded', 'invoice', invoice.id, before, { invoice: clone(invoice), payment: clone(payment), orderId: order.id, orderStatus: order.status, settled: orderSettled }, 'payment.recorded');
  return { payment: clone(payment), outcome: 'recorded', duplicate: false };
}

// 被拒绝的回调也要留痕（审计 + outbox），且不写入 payment 与幂等登记，
// 便于渠道修正后用同一流水号重新投递。
function rejectPayment(tenantId: string, actor: string, key: string, invoiceId: string, reference: string, channel: PaymentChannel, amount: number, currency: string, status: PaymentStatus, reason: string, action: string, failureReason?: string) {
  record(tenantId, actor, action, 'invoice', invoiceId, { key, channel, reference, amount, currency, callbackStatus: status, failureReason: failureReason ?? null, rejectedAt: now() }, { reason });
  emit(tenantId, 'payment.rejected', invoiceId, { key, channel, reference, amount, currency, callbackStatus: status, reason });
}

// 全额收讫后驱动订单结算。只允许 delivered -> closed（走订单 FSM），
// dispatched 等在途订单即使付清也保持原状态，由后续 deliver/close 完成结算；
// 已关闭订单幂等返回。绝不直接赋值 order.status，杜绝 cancelled -> closed 倒退。
function settlePaidOrder(order: Order, invoice: Invoice): boolean {
  if (order.status === 'closed') return false;
  if (order.status !== 'delivered') return false;
  const before = clone(order);
  transition(order, 'closed');
  const customer = state.customers.find(item => item.id === order.customerId);
  if (customer) customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount));
  record(order.tenantId, 'payment-callback', 'order.closed', 'order', order.id, before, { order: clone(order), invoiceId: invoice.id, trigger: 'payment.settled' });
  emit(order.tenantId, 'order.closed', order.id, { orderId: order.id, invoiceId: invoice.id, trigger: 'payment.settled' });
  return true;
}

// 进程内按幂等键串行化，防止并发回调在首个事务完成前双双穿透查重。
const callbackLocks = new Map<string, Promise<unknown>>();
export function handlePaymentCallback(tenantId: string, input: PaymentCallbackInput, actor = 'system'): Promise<PaymentCallbackResult> {
  const channel = (input.channel ?? input.method) as PaymentChannel | undefined;
  const reference = String(input.reference ?? '').trim();
  if (!channel || !reference) return Promise.resolve().then(() => processPaymentCallback(tenantId, input, actor));
  const key = paymentKey(tenantId, channel, reference);
  const previous = callbackLocks.get(key) ?? Promise.resolve();
  const next = previous.then(() => processPaymentCallback(tenantId, input, actor), () => processPaymentCallback(tenantId, input, actor));
  const stored = next.then(() => undefined, () => undefined);
  callbackLocks.set(key, stored);
  stored.finally(() => { if (callbackLocks.get(key) === stored) callbackLocks.delete(key); });
  return next;
}

// 兼容旧接口：同步返回 payment 对象。新代码请使用 handlePaymentCallback（含并发互斥）。
export function recordPayment(tenantId: string, input: PaymentCallbackInput, actor = 'system') {
  return processPaymentCallback(tenantId, input, actor).payment;
}

export function createApproval(tenantId: string, input: { orderId: string; type: Approval['type']; reason: string }, actor = 'system') { orderFor(tenantId, input.orderId); const approval: Approval = { id: id('APR'), tenantId, orderId: input.orderId, type: input.type, reason: input.reason, status: 'pending', createdAt: now() }; state.approvals.push(approval); record(tenantId, actor, 'approval.created', 'approval', approval.id, undefined, approval); emit(tenantId, 'approval.created', approval.id, approval); return clone(approval); }
export function decideApproval(tenantId: string, approvalId: string, input: { status: Exclude<ApprovalStatus, 'pending'>; comment?: string }, actor: string) { const approval = assertTenant(state.approvals.find(item => item.id === approvalId) ?? (() => { throw new Error('审批不存在'); })(), tenantId); if (approval.status !== 'pending') throw new Error('审批已经决策'); const before = clone(approval); approval.status = input.status; approval.decidedBy = actor; approval.comment = input.comment; approval.decidedAt = now(); if (input.status === 'approved' && approval.type === 'credit_override') { const order = orderFor(tenantId, approval.orderId); const customer = customerFor(tenantId, order.customerId); customer.creditLimit = Math.max(customer.creditLimit, customer.creditUsed + order.totalAmount); } mutate(tenantId, actor, 'approval.decided', 'approval', approval.id, before, approval, 'approval.decided'); return clone(approval); }

export function operationSummary(tenantId: string) { tenant(tenantId); const orders = listOrders(tenantId); const invoices = state.invoices.filter(item => item.tenantId === tenantId); const shipments = state.shipments.filter(item => item.tenantId === tenantId); return { tenantId, generatedAt: now(), orderCount: orders.length, byStatus: orders.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {}), grossMerchandiseValue: money(orders.reduce((sum, item) => sum + item.totalAmount, 0)), receivable: money(invoices.reduce((sum, item) => sum + item.total - item.paid, 0)), paid: money(invoices.reduce((sum, item) => sum + item.paid, 0)), delayedShipments: shipments.filter(item => item.status === 'exception').length, pendingApprovals: state.approvals.filter(item => item.tenantId === tenantId && item.status === 'pending').length, inventory: state.inventory.filter(item => item.tenantId === tenantId).map(item => ({ warehouse: item.warehouse, sku: item.sku, available: item.available, reserved: item.reserved, free: item.available - item.reserved })) }; }
export function timeline(tenantId: string, orderId: string) { const order = orderFor(tenantId, orderId); const relatedIds = new Set([order.id]); const shipment = state.shipments.find(item => item.orderId === orderId); const customs = state.customs.find(item => item.orderId === orderId); const invoice = state.invoices.find(item => item.orderId === orderId); if (shipment) relatedIds.add(shipment.id); if (customs) relatedIds.add(customs.id); if (invoice) relatedIds.add(invoice.id); state.approvals.filter(item => item.orderId === orderId).forEach(item => relatedIds.add(item.id)); return state.audit.filter(item => item.tenantId === tenantId && relatedIds.has(item.entityId)).sort((a, b) => b.at.localeCompare(a.at)).map(clone); }
export function listAudit(tenantId: string, limit = 100) { tenant(tenantId); return state.audit.filter(item => item.tenantId === tenantId).slice(0, Math.min(limit, 500)).map(clone); }
export function listOutbox(tenantId: string, status?: OutboxEvent['status']) { tenant(tenantId); return state.outbox.filter(item => item.tenantId === tenantId && (!status || item.status === status)).map(clone); }
export function publishOutbox(tenantId: string, eventId: string, actor = 'system') { const event = assertTenant(state.outbox.find(item => item.id === eventId) ?? (() => { throw new Error('事件不存在'); })(), tenantId); if (event.status === 'published') return clone(event); event.status = 'published'; event.attempts += 1; record(tenantId, actor, 'outbox.published', 'outbox', event.id, { status: 'pending' }, event); return clone(event); }


export type OrderPage = { items: Order[]; nextCursor?: string; total: number };
export function listOrdersPage(tenantId: string, input: { cursor?: string; limit?: number } = {}) {
  tenant(tenantId);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const offset = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0;
  const ordered = state.orders.filter(item => item.tenantId === tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const items = ordered.slice(offset, offset + limit).map(clone);
  return { items, nextCursor: offset + limit < ordered.length ? String(offset + limit) : undefined, total: ordered.length };
}
export function invoiceOverdue(tenantId: string, invoiceId: string, asOf = new Date()) {
  const invoice = assertTenant(state.invoices.find(item => item.id === invoiceId) ?? (() => { throw new Error('发票不存在'); })(), tenantId);
  const order = orderFor(tenantId, invoice.orderId);
  const customer = customerFor(tenantId, order.customerId);
  const customerDate = asOf.toISOString().slice(0, 10);
  return { invoiceId, overdue: customerDate > invoice.dueDate.slice(0, 10), evaluatedDate: customerDate, customerTimezone: customer.timezone ?? 'UTC' };
}

// seed a coherent flow for demos: one order is allocated, one customs declaration is cleared, and one invoice is partially paid.
const seeded = createOrder('tenant-acme', { customerId: 'CUS-001', reference: 'PO-2026-0918', origin: '上海保税区', destination: '鹿特丹', priority: 'urgent', items: [{ sku: 'SENSOR-X9', description: '工业温度传感器', quantity: 10, unitPrice: 180, weightKg: 2.4, hsCode: '9025.19' }, { sku: 'CONTROL-M2', description: '边缘控制模块', quantity: 4, unitPrice: 420, weightKg: 3.2, hsCode: '8537.10' }] });
confirmOrder('tenant-acme', seeded.id); allocateOrder('tenant-acme', seeded.id); const seededDeclaration = createCustomsDeclaration('tenant-acme', { orderId: seeded.id }); updateCustoms('tenant-acme', seededDeclaration.id, { documentRefs: ['commercial-invoice', 'packing-list', 'origin-certificate'], status: 'submitted' }); updateCustoms('tenant-acme', seededDeclaration.id, { status: 'cleared' }); dispatchOrder('tenant-acme', seeded.id); const seededInvoice = generateInvoice('tenant-acme', seeded.id); recordPayment('tenant-acme', { invoiceId: seededInvoice.id, amount: 500, method: 'bank_transfer', reference: 'BANK-DEMO-001' });
