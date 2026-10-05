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
export type PaymentMethod = 'bank_transfer' | 'card' | 'credit_note' | 'clearing';
export type PaymentChannel = 'bank_transfer' | 'card' | 'clearing';
export type PaymentStatus = 'received' | 'failed';
export type Payment = { id: string; tenantId: string; invoiceId?: string; orderId?: string; amount: number; currency: string; method: PaymentMethod; channel: PaymentChannel; reference: string; status: PaymentStatus; failureReason?: string; receivedAt: string };
// 幂等台账：(租户, 支付渠道, 第三方流水号) 唯一，记录该流水号的规范处理结果与冲突信息
type PaymentKey = { key: string; tenantId: string; channel: PaymentChannel; reference: string; status: PaymentStatus | 'conflict'; paymentId: string; fingerprint: string; amount: number; currency: string; invoiceId?: string; orderId?: string; conflictReason?: string; conflictOccurrences: number; conflictAuditId?: string; conflictFingerprint?: string; conflictIncomingStatus?: PaymentStatus; lateFailureOccurrences?: number; createdAt: string; updatedAt: string };
export type RecordPaymentResult = { outcome: 'received' | 'duplicate' | 'failed' | 'conflict'; idempotent: boolean; payment: Payment; conflict?: { reason: string; detail: string } };
type Approval = { id: string; tenantId: string; orderId: string; type: 'credit_override' | 'customs_exception' | 'delay_compensation'; reason: string; status: ApprovalStatus; decidedBy?: string; comment?: string; createdAt: string; decidedAt?: string };
export type AuditEvent = { id: string; tenantId: string; actor: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; at: string };
export type OutboxEvent = { id: string; tenantId: string; topic: string; aggregateId: string; payload: unknown; status: 'pending' | 'published'; attempts: number; createdAt: string };

type State = { tenants: Tenant[]; customers: Customer[]; orders: Order[]; inventory: InventoryLot[]; reservations: Reservation[]; shipments: Shipment[]; customs: CustomsDeclaration[]; invoices: Invoice[]; payments: Payment[]; paymentKeys: PaymentKey[]; approvals: Approval[]; audit: AuditEvent[]; outbox: OutboxEvent[] };
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
const money = (value: number) => Math.round(value * 100) / 100;

export const state: State = {
  tenants: [{ id: 'tenant-acme', name: 'Acme Global Trading', creditLimit: 250000, creditUsed: 36200, currency: 'USD' }],
  customers: [{ id: 'CUS-001', tenantId: 'tenant-acme', name: 'Northstar Retail GmbH', creditLimit: 100000, creditUsed: 12000, blocked: false, timezone: 'Europe/Berlin' }, { id: 'CUS-002', tenantId: 'tenant-acme', name: 'Pacific Parts Inc.', creditLimit: 50000, creditUsed: 49000, blocked: false, timezone: 'America/Los_Angeles' }],
  orders: [], inventory: [
    { id: 'LOT-001', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'SENSOR-X9', available: 80, reserved: 10, lotCode: 'SX9-2608' },
    { id: 'LOT-002', tenantId: 'tenant-acme', warehouse: 'SHANGHAI-FTZ', sku: 'CONTROL-M2', available: 36, reserved: 4, lotCode: 'CM2-2607' },
    { id: 'LOT-003', tenantId: 'tenant-acme', warehouse: 'ROTTERDAM-DC', sku: 'SENSOR-X9', available: 12, reserved: 0, lotCode: 'SX9-2606' }
  ], reservations: [], shipments: [], customs: [], invoices: [], payments: [], paymentKeys: [], approvals: [], audit: [], outbox: []
};

function tenant(id: string) { const value = state.tenants.find(item => item.id === id); if (!value) throw new Error('租户不存在'); return value; }
function assertTenant<T extends { tenantId: string }>(item: T, tenantId: string) { if (item.tenantId !== tenantId) throw new Error('无权访问其他租户的数据'); return item; }
function customerFor(tenantId: string, customerId: string) { const customer = state.customers.find(item => item.id === customerId && item.tenantId === tenantId); if (!customer) throw new Error('客户不存在'); return customer; }
function orderFor(tenantId: string, orderId: string) { const order = state.orders.find(item => item.id === orderId); if (!order) throw new Error('订单不存在'); return assertTenant(order, tenantId); }
function record(tenantId: string, actor: string, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) { const event: AuditEvent = { id: id('AUD'), tenantId, actor, action, entityType, entityId, before: before === undefined ? undefined : clone(before), after: after === undefined ? undefined : clone(after), at: now() }; state.audit.unshift(event); return event; }
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
export function closeOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const invoice = state.invoices.find(item => item.orderId === orderId); if (!invoice || invoice.status !== 'paid') throw new Error('发票未完成收款核销'); const before = clone(order); transition(order, 'closed'); const customer = customerFor(tenantId, order.customerId); customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount)); mutate(tenantId, actor, 'order.closed', 'order', order.id, before, order, 'order.closed'); return clone(order); }
export function cancelOrder(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const before = clone(order); if (['dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('已出运订单不能取消'); const paidInvoice = state.invoices.find(item => item.orderId === orderId && item.status !== 'void' && item.paid > 0); if (paidInvoice) throw new Error(`发票 ${paidInvoice.number} 已有收款（${paidInvoice.paid} ${paidInvoice.currency}），订单不能直接取消，请先完成退款或红冲`); transition(order, 'cancelled'); const reservation = state.reservations.find(item => item.orderId === orderId && item.status === 'active'); if (reservation) { state.inventory.find(lot => lot.id === reservation.lotId)!.reserved -= reservation.quantity; reservation.status = 'released'; } const customer = customerFor(tenantId, order.customerId); if (before.status !== 'draft') customer.creditUsed = money(Math.max(0, customer.creditUsed - order.totalAmount)); mutate(tenantId, actor, 'order.cancelled', 'order', order.id, before, order, 'order.cancelled'); return clone(order); }

export function createCustomsDeclaration(tenantId: string, input: { orderId: string; country?: string; requiredDocuments?: string[] }, actor = 'system') { const order = orderFor(tenantId, input.orderId); if (state.customs.some(item => item.orderId === order.id)) throw new Error('订单已有海关申报'); const declaration: CustomsDeclaration = { id: id('CUS'), tenantId, orderId: order.id, country: input.country ?? order.destination, status: 'draft', documentRefs: [], requiredDocuments: input.requiredDocuments ?? ['commercial-invoice', 'packing-list', 'origin-certificate'], riskScore: order.priority === 'critical' ? 82 : order.totalWeightKg > 1000 ? 60 : 24, updatedAt: now() }; state.customs.push(declaration); order.customsDeclarationId = declaration.id; mutate(tenantId, actor, 'customs.created', 'customs', declaration.id, undefined, declaration, 'customs.created'); return clone(declaration); }
export function updateCustoms(tenantId: string, declarationId: string, input: { status?: CustomsStatus; documentRefs?: string[]; rejectionReason?: string }, actor = 'system') { const declaration = assertTenant(state.customs.find(item => item.id === declarationId) ?? (() => { throw new Error('海关申报不存在'); })(), tenantId); const before = clone(declaration); if (input.documentRefs) declaration.documentRefs = [...new Set(input.documentRefs)]; if (input.status) { if (input.status === 'cleared' && declaration.requiredDocuments.some(doc => !declaration.documentRefs.includes(doc))) throw new Error('放行前必须补齐所有必需单证'); if (input.status === 'inspection' && declaration.status !== 'submitted') throw new Error('只有已提交申报才能进入查验'); declaration.status = input.status; } declaration.rejectionReason = input.rejectionReason; declaration.updatedAt = now(); mutate(tenantId, actor, 'customs.updated', 'customs', declaration.id, before, declaration, 'customs.updated'); return clone(declaration); }
export function addShipmentEvent(tenantId: string, shipmentId: string, input: { code: string; location: string; occurredAt?: string; note?: string }, actor = 'system') { const shipment = assertTenant(state.shipments.find(item => item.id === shipmentId) ?? (() => { throw new Error('运输单不存在'); })(), tenantId); if (!input.code || !input.location) throw new Error('轨迹编码和位置不能为空'); const event = { id: id('TRK'), code: input.code, location: input.location, occurredAt: input.occurredAt ?? now(), note: input.note }; shipment.events.push(event); shipment.currentLocation = input.location; if (input.code === 'DEPARTED') { shipment.status = 'in_transit'; shipment.legs[0].status = 'in_transit'; } if (input.code === 'DELAYED') { shipment.status = 'exception'; shipment.legs.find(leg => leg.status !== 'arrived')!.status = 'delayed'; createApproval(tenantId, { orderId: shipment.orderId, type: 'delay_compensation', reason: `运输轨迹 ${shipment.trackingNo} 发生延误` }, actor); } if (input.code === 'ARRIVED') shipment.legs[shipment.legs.length - 1].status = 'arrived'; record(tenantId, actor, 'shipment.event.added', 'shipment', shipment.id, undefined, event); emit(tenantId, 'shipment.event.added', shipment.id, event); return clone(shipment); }

export function generateInvoice(tenantId: string, orderId: string, actor = 'system') { const order = orderFor(tenantId, orderId); const existing = state.invoices.find(item => item.orderId === orderId); if (existing) return clone(existing); if (!['allocated', 'dispatched', 'delivered', 'closed'].includes(order.status)) throw new Error('订单完成库存分配后才能开票'); const freight = money(Math.max(120, order.totalWeightKg * (order.priority === 'critical' ? 4.2 : 2.1))); const fuel = money(freight * 0.13); const customsFee = money(95 + order.items.length * 25); const lines: InvoiceLine[] = [{ code: 'GOODS', description: '货物服务费', quantity: 1, unitPrice: order.subtotal, amount: order.subtotal }, { code: 'FREIGHT', description: '跨境运输费', quantity: 1, unitPrice: freight, amount: freight }, { code: 'FUEL', description: '燃油附加费', quantity: 1, unitPrice: fuel, amount: fuel }, { code: 'CUSTOMS', description: '关务服务费', quantity: 1, unitPrice: customsFee, amount: customsFee }]; const subtotal = money(lines.reduce((sum, line) => sum + line.amount, 0)); const tax = money(subtotal * 0.06); const invoice: Invoice = { id: id('INV'), tenantId, orderId, number: `INV-${new Date().getFullYear()}-${String(state.invoices.length + 1).padStart(5, '0')}`, status: 'issued', currency: order.currency, lines, subtotal, tax, total: money(subtotal + tax), paid: 0, dueDate: new Date(Date.now() + 30 * 86400000).toISOString(), createdAt: now() }; state.invoices.push(invoice); order.invoiceId = invoice.id; mutate(tenantId, actor, 'invoice.issued', 'invoice', invoice.id, undefined, invoice, 'invoice.issued'); return clone(invoice); }
// 支付回调冲突：金额/币种/发票/订单不一致，或晚到通知与既有结果矛盾时抛出，HTTP 层映射为 409
export class PaymentConflictError extends Error {
  readonly statusCode = 409;
  readonly conflictCode: string;
  readonly idempotent: boolean;
  constructor(message: string, conflictCode: string, idempotent: boolean) { super(message); this.name = 'PaymentConflictError'; this.conflictCode = conflictCode; this.idempotent = idempotent; }
}
const normalizeChannel = (method: PaymentMethod | undefined, channel: PaymentChannel | undefined): PaymentChannel => {
  if (channel) return channel;
  if (method === 'card') return 'card';
  if (method === 'clearing') return 'clearing';
  return 'bank_transfer';
};
const paymentIdempotencyKey = (tenantId: string, channel: PaymentChannel, reference: string) => `${tenantId}|${channel}|${reference}`;
type PaymentFingerprint = { amountCents: number; currency: string; invoiceId: string };
const fingerprintOf = (input: PaymentFingerprint) => `${input.invoiceId}|${input.currency}|${input.amountCents}`;

export function recordPayment(tenantId: string, input: { invoiceId: string; amount: number; currency?: string; method?: PaymentMethod; channel?: PaymentChannel; reference: string; status?: PaymentStatus; failureReason?: string }, actor = 'system'): RecordPaymentResult {
  // 整个入账过程保持同步、无 await：Node 事件循环下回调之间天然串行，构成进程内原子边界
  tenant(tenantId);
  const reference = input.reference?.trim();
  if (!reference) throw new Error('第三方流水号不能为空');
  const status: PaymentStatus = input.status === 'failed' ? 'failed' : 'received';
  const method: PaymentMethod = input.method ?? 'bank_transfer';
  const channel = normalizeChannel(input.method, input.channel);
  const key = paymentIdempotencyKey(tenantId, channel, reference);
  const existingKey = state.paymentKeys.find(item => item.key === key);
  const invoice = assertTenant(state.invoices.find(item => item.id === input.invoiceId) ?? (() => { throw new Error('发票不存在'); })(), tenantId);

  // —— 幂等回放：相同流水号 + 相同业务指纹，直接返回规范结果，不再写 payment / audit / outbox ——
  if (existingKey && existingKey.status !== 'conflict') {
    const canonical = state.payments.find(item => item.id === existingKey.paymentId)!;
    // 晚到的失败通知：钱已经入账，绝不冲销、不退、不回退订单（优先级高于指纹比对）
    if (existingKey.status === 'received' && status === 'failed') {
      existingKey.lateFailureOccurrences = (existingKey.lateFailureOccurrences ?? 0) + 1;
      existingKey.updatedAt = now();
      if (existingKey.lateFailureOccurrences === 1) {
        existingKey.conflictAuditId = record(tenantId, actor, 'payment.failure_rejected_late', 'invoice', invoice.id,
          { paymentId: canonical.id, reference, appliedStatus: 'received' },
          { incomingStatus: 'failed', failureReason: input.failureReason ?? null, note: '失败通知晚于成功入账到达，资金不做冲销，需人工对账' }).id;
      }
      return { outcome: 'conflict', idempotent: true, payment: clone(canonical), conflict: { reason: 'late_failure', detail: '该流水号已成功入账，晚到的失败通知不会冲销款项或回退订单' } };
    }
    const sameFingerprint = existingKey.fingerprint === fingerprintOf({
      amountCents: Math.round(input.amount * 100),
      currency: (input.currency ?? existingKey.currency).trim().toUpperCase(),
      invoiceId: invoice.id
    });
    if (status === existingKey.status && sameFingerprint) {
      // 正常的重复成功/失败回调：即使该键此前记录过晚到失败冲突，也以当前规范状态为准回放
      return { outcome: existingKey.status === 'failed' ? 'failed' : 'duplicate', idempotent: true, payment: clone(canonical) };
    }
    // 失败后又收到成功（迟到的成功）：以资金实际到账为准，在同一幂等键上补入账
    if (existingKey.status === 'failed' && status === 'received' && sameFingerprint) {
      const conflict = findApplicabilityConflict(invoice, state.orders.find(o => o.id === invoice.orderId), existingKey.currency, Math.round(input.amount * 100), input.amount);
      if (conflict) throw registerConflict(existingKey, invoice, { amount: input.amount, currency: existingKey.currency, status, method, failureReason: input.failureReason }, actor, conflict);
      commitReceivedPayment(existingKey, canonical, invoice, { amount: input.amount, currency: existingKey.currency, method, reference }, actor);
      return { outcome: 'received', idempotent: false, payment: clone(state.payments.find(p => p.id === canonical.id)!) };
    }
    // 业务内容不一致：拒绝入账并落冲突审计
    throw registerConflict(existingKey, invoice, { amount: input.amount, currency: input.currency, status, method, failureReason: input.failureReason }, actor);
  }

  // 已登记为冲突的流水号：
  //   - 规范 payment 已实际入账且报文与指纹一致：幂等回放同一笔支付（绝不二次入账）
  //   - 规范 payment 是 failed、报文与指纹一致且当下校验通过：迟到的成功，补入账一次
  //   - 与上一条冲突报文完全一致的重放：抛冲突但不重复刷审计
  //   - 其他内容变化或仍不满足入账条件：追加/复用冲突审计
  if (existingKey && existingKey.status === 'conflict') {
    const incomingCurrency = (input.currency ?? invoice.currency).trim().toUpperCase();
    const incomingFingerprint = fingerprintOf({ amountCents: Math.round(input.amount * 100), currency: incomingCurrency, invoiceId: invoice.id });
    const canonicalPayment = state.payments.find(item => item.id === existingKey.paymentId);
    if (status === 'received' && incomingFingerprint === existingKey.fingerprint) {
      if (canonicalPayment?.status === 'received') {
        return { outcome: 'duplicate', idempotent: true, payment: clone(canonicalPayment) };
      }
      if (canonicalPayment?.status === 'failed') {
        const conflict = findApplicabilityConflict(invoice, state.orders.find(o => o.id === invoice.orderId), incomingCurrency, Math.round(input.amount * 100), input.amount);
        if (conflict) throw registerConflict(existingKey, invoice, { amount: input.amount, currency: input.currency, status, method, failureReason: input.failureReason }, actor, conflict);
        commitReceivedPayment(existingKey, canonicalPayment, invoice, { amount: input.amount, currency: incomingCurrency, method, reference }, actor);
        return { outcome: 'received', idempotent: false, payment: clone(canonicalPayment) };
      }
      // 冲突键没有对应的实际 payment（如发票曾作废/订单曾取消/超额被拒）：保持拒绝，要求人工对账
      throw registerConflict(existingKey, invoice, { amount: input.amount, currency: input.currency, status, method, failureReason: input.failureReason }, actor,
        { code: 'conflict_key_requires_manual_review', message: `流水号 ${reference} 曾被拒绝（${existingKey.conflictReason ?? '业务冲突'}），需人工对账后处理`, detail: { priorReason: existingKey.conflictReason ?? null } });
    }
    throw registerConflict(existingKey, invoice, { amount: input.amount, currency: input.currency, status, method, failureReason: input.failureReason }, actor);
  }

  // —— 首次见到该流水号 ——
  if (!(input.amount > 0)) throw new Error('收款金额必须为正数');
  const currency = (input.currency ?? invoice.currency).trim().toUpperCase();
  const amountCents = Math.round(input.amount * 100);
  const order = state.orders.find(item => item.id === invoice.orderId);
  const receivedAt = now();

  // 新登记失败通知：留下 failed payment 与审计，但绝不触碰发票已收金额
  if (status === 'failed') {
    const payment: Payment = { id: id('PAY'), tenantId, invoiceId: invoice.id, orderId: order?.id, amount: money(input.amount), currency, method, channel, reference, status: 'failed', failureReason: input.failureReason ?? '渠道回调声明支付失败', receivedAt };
    state.payments.push(payment);
    const keyRecord: PaymentKey = { key, tenantId, channel, reference, status: 'failed', paymentId: payment.id, fingerprint: fingerprintOf({ amountCents, currency, invoiceId: invoice.id }), amount: payment.amount, currency, invoiceId: invoice.id, orderId: order?.id, conflictOccurrences: 0, createdAt: receivedAt, updatedAt: receivedAt };
    state.paymentKeys.push(keyRecord);
    record(tenantId, actor, 'payment.failed', 'invoice', invoice.id, undefined, { payment, invoice: clone(invoice) });
    emit(tenantId, 'payment.failed', invoice.id, { paymentId: payment.id, invoiceId: invoice.id, reference, amount: payment.amount, currency });
    return { outcome: 'failed', idempotent: false, payment: clone(payment) };
  }

  const paymentSeed: Payment = { id: id('PAY'), tenantId, invoiceId: invoice.id, orderId: order?.id, amount: money(input.amount), currency, method, channel, reference, status: 'received', receivedAt };
  const keyRecord: PaymentKey = { key, tenantId, channel, reference, status: 'received', paymentId: '', fingerprint: fingerprintOf({ amountCents, currency, invoiceId: invoice.id }), amount: paymentSeed.amount, currency, invoiceId: invoice.id, orderId: order?.id, conflictOccurrences: 0, createdAt: receivedAt, updatedAt: receivedAt };
  // 先校验后落库：拒绝路径只会登记冲突键与审计，绝不创建 payment、不动发票
  assertPaymentApplicable(invoice, order, currency, amountCents, keyRecord, { amount: input.amount, method, failureReason: input.failureReason }, actor);

  // 校验通过：创建 payment、登记幂等键、入账
  state.payments.push(paymentSeed);
  keyRecord.paymentId = paymentSeed.id;
  state.paymentKeys.push(keyRecord);
  commitReceivedPayment(keyRecord, paymentSeed, invoice, { amount: input.amount, currency, method, reference }, actor);
  return { outcome: 'received', idempotent: false, payment: clone(paymentSeed) };
}

// 收款前置业务校验：失败时只登记冲突键与审计，不创建 payment、不动发票
function assertPaymentApplicable(invoice: Invoice, order: Order | undefined, currency: string, amountCents: number, keyRecord: PaymentKey, incoming: { amount: number; method: PaymentMethod; failureReason?: string }, actor: string): void {
  const conflict = findApplicabilityConflict(invoice, order, currency, amountCents, incoming.amount);
  if (conflict) {
    state.paymentKeys.push(keyRecord);
    registerConflict(keyRecord, invoice, { amount: incoming.amount, currency, status: 'received', method: incoming.method, failureReason: incoming.failureReason }, actor, conflict);
    throw new PaymentConflictError(conflict.message, conflict.code, false);
  }
}

// 纯规则校验：作废发票 / 币种不符 / 订单已取消 / 已付清 / 超额
function findApplicabilityConflict(invoice: Invoice, order: Order | undefined, currency: string, amountCents: number, incomingAmount: number) {
  const paidCents = Math.round(invoice.paid * 100);
  const totalCents = Math.round(invoice.total * 100);
  if (invoice.status === 'void') return { code: 'invoice_void' as const, message: `发票 ${invoice.number} 已作废，不能入账`, detail: { invoiceId: invoice.id, status: invoice.status } };
  if (currency !== invoice.currency.trim().toUpperCase()) return { code: 'currency_mismatch' as const, message: `流水号币种 ${currency} 与发票币种 ${invoice.currency} 不一致`, detail: { expected: invoice.currency, incoming: currency } };
  if (order?.status === 'cancelled') return { code: 'order_cancelled' as const, message: `订单 ${order.reference} 已取消，拒绝收款入账`, detail: { orderId: order.id, orderStatus: order.status } };
  if (paidCents >= totalCents) return { code: 'invoice_already_paid' as const, message: `发票 ${invoice.number} 已付清，不能重复入账`, detail: { invoiceId: invoice.id, paid: invoice.paid, total: invoice.total } };
  if (amountCents > totalCents - paidCents) return { code: 'amount_exceeds_balance' as const, message: `收款金额超过发票未核销余额（剩余 ${money((totalCents - paidCents) / 100)} ${invoice.currency}）`, detail: { paid: invoice.paid, total: invoice.total, incoming: incomingAmount } };
  return undefined;
}

// 记录/刷新冲突：与上一条冲突报文内容完全相同的重试幂等回放，内容变化才追加审计；不修改任何资金状态
function registerConflict(keyRecord: PaymentKey, invoice: Invoice, incoming: { amount: number; currency?: string; status: PaymentStatus; method: PaymentMethod; failureReason?: string }, actor: string, preset?: { code: string; message: string; detail: unknown }): PaymentConflictError {
  const incomingCurrency = (incoming.currency ?? invoice.currency).trim().toUpperCase();
  const incomingFingerprint = fingerprintOf({ amountCents: Math.round(incoming.amount * 100), currency: incomingCurrency, invoiceId: invoice.id });
  const code = preset?.code ?? 'fingerprint_mismatch';
  const message = preset?.message ?? `流水号 ${keyRecord.reference} 的回调内容（金额/币种/发票/状态）与既有入账不一致，拒绝入账，需人工对账`;
  const replayOfSameConflict = keyRecord.conflictAuditId !== undefined
    && keyRecord.conflictReason === code
    && keyRecord.conflictIncomingStatus === incoming.status
    && keyRecord.conflictFingerprint === incomingFingerprint;
  keyRecord.status = 'conflict';
  keyRecord.conflictReason = code;
  keyRecord.conflictOccurrences += 1;
  keyRecord.updatedAt = now();
  if (!replayOfSameConflict) {
    const canonicalPayment = keyRecord.paymentId ? state.payments.find(p => p.id === keyRecord.paymentId) : undefined;
    const auditId = record(keyRecord.tenantId, actor, 'payment.conflict', 'invoice', invoice.id,
      { canonical: { paymentId: canonicalPayment?.id ?? null, fingerprint: keyRecord.fingerprint, status: canonicalPayment?.status ?? null } },
      { incoming: { fingerprint: incomingFingerprint, status: incoming.status, amount: incoming.amount, currency: incoming.currency ?? null, failureReason: incoming.failureReason ?? null }, reason: code, detail: preset?.detail ?? null, occurrences: keyRecord.conflictOccurrences }).id;
    keyRecord.conflictAuditId = auditId;
    keyRecord.conflictFingerprint = incomingFingerprint;
    keyRecord.conflictIncomingStatus = incoming.status;
  }
  return new PaymentConflictError(message, code, keyRecord.conflictOccurrences > 1);
}

// 把一笔实际到账的钱提交到发票上：每次真实资金应用恰好执行一次，幂等回放/冲突拒绝都不会进入这里
function commitReceivedPayment(keyRecord: PaymentKey, payment: Payment, invoice: Invoice, incoming: { amount: number; currency: string; method: PaymentMethod; reference: string }, actor: string): void {
  const before = clone(invoice);
  const wasSettled = invoice.status === 'paid';
  payment.status = 'received';
  payment.failureReason = undefined;
  payment.amount = money(incoming.amount);
  payment.currency = incoming.currency;
  payment.method = incoming.method;
  const paidCents = Math.round(invoice.paid * 100) + Math.round(incoming.amount * 100);
  const totalCents = Math.round(invoice.total * 100);
  if (paidCents > totalCents) throw new PaymentConflictError('入账会导致发票已收超过总额', 'amount_exceeds_balance', false); // 兜底，理论上前置校验已拦截
  invoice.paid = money(paidCents / 100);
  invoice.status = paidCents >= totalCents ? 'paid' : 'partially_paid';
  keyRecord.status = 'received';
  keyRecord.conflictReason = undefined;
  keyRecord.fingerprint = fingerprintOf({ amountCents: Math.round(incoming.amount * 100), currency: incoming.currency, invoiceId: invoice.id });
  keyRecord.amount = payment.amount;
  keyRecord.currency = incoming.currency;
  keyRecord.invoiceId = invoice.id;
  keyRecord.updatedAt = now();
  record(keyRecord.tenantId, actor, 'payment.received', 'invoice', invoice.id, before, { payment: clone(payment), invoice: clone(invoice) });
  emit(keyRecord.tenantId, 'payment.received', invoice.id, { paymentId: payment.id, invoiceId: invoice.id, orderId: invoice.orderId, reference: incoming.reference, channel: keyRecord.channel, amount: payment.amount, currency: incoming.currency });
  if (invoice.status === 'paid' && !wasSettled) {
    record(keyRecord.tenantId, actor, 'invoice.settled', 'invoice', invoice.id, before, clone(invoice));
    emit(keyRecord.tenantId, 'invoice.settled', invoice.id, { invoiceId: invoice.id, orderId: invoice.orderId, paid: invoice.paid, total: invoice.total });
  }
}

export function createApproval(tenantId: string, input: { orderId: string; type: Approval['type']; reason: string }, actor = 'system') { orderFor(tenantId, input.orderId); const approval: Approval = { id: id('APR'), tenantId, orderId: input.orderId, type: input.type, reason: input.reason, status: 'pending', createdAt: now() }; state.approvals.push(approval); record(tenantId, actor, 'approval.created', 'approval', approval.id, undefined, approval); emit(tenantId, 'approval.created', approval.id, approval); return clone(approval); }
export function decideApproval(tenantId: string, approvalId: string, input: { status: Exclude<ApprovalStatus, 'pending'>; comment?: string }, actor: string) { const approval = assertTenant(state.approvals.find(item => item.id === approvalId) ?? (() => { throw new Error('审批不存在'); })(), tenantId); if (approval.status !== 'pending') throw new Error('审批已经决策'); const before = clone(approval); approval.status = input.status; approval.decidedBy = actor; approval.comment = input.comment; approval.decidedAt = now(); if (input.status === 'approved' && approval.type === 'credit_override') { const order = orderFor(tenantId, approval.orderId); const customer = customerFor(tenantId, order.customerId); customer.creditLimit = Math.max(customer.creditLimit, customer.creditUsed + order.totalAmount); } mutate(tenantId, actor, 'approval.decided', 'approval', approval.id, before, approval, 'approval.decided'); return clone(approval); }

export function operationSummary(tenantId: string) { tenant(tenantId); const orders = listOrders(tenantId); const invoices = state.invoices.filter(item => item.tenantId === tenantId); const shipments = state.shipments.filter(item => item.tenantId === tenantId); return { tenantId, generatedAt: now(), orderCount: orders.length, byStatus: orders.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {}), grossMerchandiseValue: money(orders.reduce((sum, item) => sum + item.totalAmount, 0)), receivable: money(invoices.reduce((sum, item) => sum + item.total - item.paid, 0)), paid: money(invoices.reduce((sum, item) => sum + item.paid, 0)), delayedShipments: shipments.filter(item => item.status === 'exception').length, pendingApprovals: state.approvals.filter(item => item.tenantId === tenantId && item.status === 'pending').length, inventory: state.inventory.filter(item => item.tenantId === tenantId).map(item => ({ warehouse: item.warehouse, sku: item.sku, available: item.available, reserved: item.reserved, free: item.available - item.reserved })) }; }
export function timeline(tenantId: string, orderId: string) { const order = orderFor(tenantId, orderId); const relatedIds = new Set([order.id]); const shipment = state.shipments.find(item => item.orderId === orderId); const customs = state.customs.find(item => item.orderId === orderId); const invoice = state.invoices.find(item => item.orderId === orderId); if (shipment) relatedIds.add(shipment.id); if (customs) relatedIds.add(customs.id); if (invoice) relatedIds.add(invoice.id); state.approvals.filter(item => item.orderId === orderId).forEach(item => relatedIds.add(item.id)); return state.audit.filter(item => item.tenantId === tenantId && relatedIds.has(item.entityId)).sort((a, b) => b.at.localeCompare(a.at)).map(clone); }
export function listAudit(tenantId: string, limit = 100) { tenant(tenantId); return state.audit.filter(item => item.tenantId === tenantId).slice(0, Math.min(limit, 500)).map(clone); }
export function listOutbox(tenantId: string, status?: OutboxEvent['status']) { tenant(tenantId); return state.outbox.filter(item => (!status || item.status === status)).map(clone); }
export function publishOutbox(tenantId: string, eventId: string, actor = 'system') { const event = assertTenant(state.outbox.find(item => item.id === eventId) ?? (() => { throw new Error('事件不存在'); })(), tenantId); if (event.status === 'published') { event.attempts += 1; return clone(event); } event.status = 'published'; event.attempts += 1; record(tenantId, actor, 'outbox.published', 'outbox', event.id, { status: 'pending' }, { id: event.id, topic: event.topic, status: event.status, attempts: event.attempts }); return clone(event); }


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
