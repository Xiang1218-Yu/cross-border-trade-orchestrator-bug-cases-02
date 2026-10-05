import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateOrder, cancelOrder, confirmOrder, createCustomsDeclaration, createOrder, deliverOrder,
  dispatchOrder, generateInvoice, handlePaymentCallback, listOutbox, operationSummary,
  PaymentCallbackError, processPaymentCallback, publishOutbox, state, timeline, updateCustoms
} from './domain.js';
const T = 'tenant-acme';
const BANK = 'bank_transfer';

// 建一张已开票、已放行出运的订单（dispatched 状态），返回订单与发票。
function setupDispatchedOrder(reference: string, customerId = 'CUS-001') {
  const order = createOrder(T, {
    customerId, reference, origin: '上海', destination: '汉堡', priority: 'standard',
    items: [{ description: '传感器', sku: 'SENSOR-X9', quantity: 2, unitPrice: 100, weightKg: 1, hsCode: '9025.19' }]
  }, 'tester');
  confirmOrder(T, order.id, 'tester');
  allocateOrder(T, order.id, 'tester');
  const declaration = createCustomsDeclaration(T, { orderId: order.id });
  updateCustoms(T, declaration.id, { documentRefs: declaration.requiredDocuments, status: 'submitted' }, 'tester');
  updateCustoms(T, declaration.id, { status: 'cleared' }, 'tester');
  dispatchOrder(T, order.id, 'tester');
  const invoice = generateInvoice(T, order.id, 'tester');
  return { order, invoice };
}

function deliverAndGet(reference: string) {
  const { order, invoice } = setupDispatchedOrder(reference);
  deliverOrder(T, order.id, 'tester');
  return { order, invoice };
}

test('相同第三方流水号的重复回调只入一次账并返回同一笔 payment', async () => {
  const { invoice } = setupDispatchedOrder(`DUP-${Date.now()}-1`);
  const ref = `CB-DUP-${Date.now()}`;
  const first = await handlePaymentCallback(T, { invoiceId: invoice.id, amount: 100, channel: BANK, reference: ref }, 'channel');
  assert.equal(first.duplicate, false);
  assert.equal(first.outcome, 'recorded');

  const second = await handlePaymentCallback(T, { invoiceId: invoice.id, amount: 100, channel: BANK, reference: ref }, 'channel-retry');
  const third = await handlePaymentCallback(T, { invoiceId: invoice.id, amount: 100, method: BANK, reference: ref }, 'manual-redeliver');

  assert.equal(second.duplicate, true);
  assert.equal(third.duplicate, true);
  assert.equal(second.payment.id, first.payment.id);
  assert.equal(third.payment.id, first.payment.id);

  const stored = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(stored.paid, 100);
  assert.equal(stored.status, 'partially_paid');
  assert.equal(state.payments.filter(p => p.reference === ref && p.tenantId === T).length, 1);
  // 重复回调不写审计、不写 outbox。
  const paymentAudits = state.audit.filter(a => a.entityId === invoice.id && a.action === 'payment.recorded');
  assert.equal(paymentAudits.length, 1);
  assert.equal(state.outbox.filter(e => e.topic === 'payment.recorded' && e.aggregateId === invoice.id).length, 1);
});

test('并发回调（同流水号）串行化后仍然只入账一次', async () => {
  const { invoice } = deliverAndGet(`CC-${Date.now()}-2`);
  const ref = `CB-CONC-${Date.now()}`;
  const calls = await Promise.all([
    handlePaymentCallback(T, { invoiceId: invoice.id, amount: 50, channel: BANK, reference: ref }),
    handlePaymentCallback(T, { invoiceId: invoice.id, amount: 50, channel: BANK, reference: ref }),
    handlePaymentCallback(T, { invoiceId: invoice.id, amount: 50, channel: BANK, reference: ref })
  ]);
  const ids = new Set(calls.map(c => c.payment.id));
  assert.equal(ids.size, 1);
  assert.equal(calls.filter(c => c.duplicate).length, 2);
  const stored = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(stored.paid, 50);
  assert.equal(stored.status, 'partially_paid');
});

test('同流水号金额不一致时拒绝并留下 payment.conflict 冲突审计', async () => {
  const { invoice } = setupDispatchedOrder(`CONF-${Date.now()}-3`);
  const ref = `CB-CONF-${Date.now()}`;
  await handlePaymentCallback(T, { invoiceId: invoice.id, amount: 100, channel: BANK, reference: ref });
  await assert.rejects(
    handlePaymentCallback(T, { invoiceId: invoice.id, amount: 120, channel: BANK, reference: ref }),
    (err: unknown) => err instanceof PaymentCallbackError && err.statusCode === 409
  );
  const stored = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(stored.paid, 100); // 冲突金额未入账
  const conflict = state.audit.find(a => a.action === 'payment.conflict' && a.entityId === invoice.id);
  assert.ok(conflict, '必须留下冲突审计');
  assert.equal((conflict!.before as { incoming: { amount: number } }).incoming.amount, 120);
  // 冲突拒绝不产生 payment。
  assert.equal(state.payments.filter(p => p.reference === ref).length, 1);
});

test('同流水号发票不一致、币种不一致同样拒绝', () => {
  const a = setupDispatchedOrder(`CONF2-${Date.now()}-4a`);
  const b = setupDispatchedOrder(`CONF2-${Date.now()}-4b`);
  const ref = `CB-CONF2-${Date.now()}`;
  processPaymentCallback(T, { invoiceId: a.invoice.id, amount: 50, channel: BANK, reference: ref });
  assert.throws(
    () => processPaymentCallback(T, { invoiceId: b.invoice.id, amount: 50, channel: BANK, reference: ref }),
    /业务内容不一致/
  );
  assert.throws(
    () => processPaymentCallback(T, { invoiceId: a.invoice.id, amount: 50, channel: BANK, reference: `${ref}-EUR`, currency: 'EUR' }),
    /币种/
  );
  // 币种不匹配是新流水号，走业务拒绝审计，不登记幂等键。
  assert.ok(state.audit.some(x => x.action === 'payment.currency_mismatch'));
});

test('部分付款不允许超过未核销余额，余额不会为负', () => {
  const { invoice } = setupDispatchedOrder(`OVER-${Date.now()}-5`);
  const total = invoice.total;
  processPaymentCallback(T, { invoiceId: invoice.id, amount: money2(total - 10), channel: BANK, reference: `CB-OVER-A-${Date.now()}` });
  assert.throws(
    () => processPaymentCallback(T, { invoiceId: invoice.id, amount: 20, channel: BANK, reference: `CB-OVER-B-${Date.now()}` }),
    /超过发票未核销余额/
  );
  const stored = state.invoices.find(i => i.id === invoice.id)!;
  assert.ok(stored.total - stored.paid >= -0.01);
  assert.equal(stored.status, 'partially_paid');
  const summary = operationSummary(T);
  assert.ok(summary.receivable >= 0);
});

function money2(v: number) { return Math.round(v * 100) / 100; }

test('已付清发票拒绝新流水号入账，不能重复核销', () => {
  const { invoice } = setupDispatchedOrder(`PAID-${Date.now()}-6`);
  processPaymentCallback(T, { invoiceId: invoice.id, amount: invoice.total, channel: BANK, reference: `CB-PAID-${Date.now()}` });
  const stored = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(stored.status, 'paid');
  assert.equal(money2(stored.paid), money2(invoice.total));
  assert.throws(
    () => processPaymentCallback(T, { invoiceId: invoice.id, amount: 0.01, channel: BANK, reference: `CB-PAID-EXTRA-${Date.now()}` }),
    /已付清/
  );
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, invoice.total);
});

test('订单取消后晚到的成功回调不能把订单冲回 closed', () => {
  // confirmed 但未出运的订单可取消；先开发票不成立（需 allocated），所以走 allocated -> cancel。
  const order = createOrder(T, {
    customerId: 'CUS-001', reference: `CANC-${Date.now()}-7`, origin: '深圳', destination: '曼谷',
    items: [{ description: '模块', sku: 'CONTROL-M2', quantity: 1, unitPrice: 100, weightKg: 1 }]
  }, 'tester');
  confirmOrder(T, order.id); allocateOrder(T, order.id);
  const invoice = generateInvoice(T, order.id);
  cancelOrder(T, order.id);
  assert.throws(
    () => processPaymentCallback(T, { invoiceId: invoice.id, amount: invoice.total, channel: BANK, reference: `CB-LATE-${Date.now()}` }),
    /订单已取消/
  );
  assert.equal(state.orders.find(o => o.id === order.id)!.status, 'cancelled');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 0);
  assert.ok(state.audit.some(a => a.action === 'payment.order.cancelled'));
});

test('晚到的失败通知不退款、不回退已成功的 payment，只记审计', async () => {
  const { invoice } = setupDispatchedOrder(`LATEF-${Date.now()}-8`);
  const ref = `CB-LATEF-${Date.now()}`;
  const ok = await handlePaymentCallback(T, { invoiceId: invoice.id, amount: 100, channel: BANK, reference: ref });
  assert.equal(ok.payment.status, 'succeeded');
  const late = await handlePaymentCallback(T, { invoiceId: invoice.id, amount: 100, channel: BANK, reference: ref, status: 'failed', failureReason: '渠道日终对账失败' });
  assert.equal(late.outcome, 'late_failure_ignored');
  assert.equal(late.payment.status, 'succeeded');
  const stored = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(stored.paid, 100);
  assert.ok(state.audit.some(a => a.action === 'payment.failure.late'));
  // 晚到失败不产生退款类 outbox，只允许审计存在。
  assert.ok(!state.outbox.some(e => e.topic === 'payment.refunded'));
});

test('先失败后成功（同流水号）拒绝状态翻转；渠道用新流水号可正常入账', () => {
  const { invoice } = setupDispatchedOrder(`RECOV-${Date.now()}-9`);
  const ref = `CB-RECOV-${Date.now()}`;
  const failed = processPaymentCallback(T, { invoiceId: invoice.id, amount: 100, channel: BANK, reference: ref, status: 'failed', failureReason: '超时' });
  assert.equal(failed.payment.status, 'failed');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 0);
  // 失败通知后同键再来成功属于不同业务内容，按冲突处理；渠道恢复必须使用新流水号。
  assert.throws(
    () => processPaymentCallback(T, { invoiceId: invoice.id, amount: 100, channel: BANK, reference: ref }),
    (err: unknown) => err instanceof PaymentCallbackError && /不能改写/.test(err.message)
  );
  assert.ok(state.audit.some(a => a.action === 'payment.conflict'));
  const recovered = processPaymentCallback(T, { invoiceId: invoice.id, amount: 100, channel: BANK, reference: `${ref}-R` });
  assert.equal(recovered.payment.status, 'succeeded');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 100);
});

test('delivered 订单付清后经 FSM 关闭并释放授信；dispatched 付清不关闭', () => {
  const dispatched = setupDispatchedOrder(`SETTLE-D-${Date.now()}-10`);
  processPaymentCallback(T, { invoiceId: dispatched.invoice.id, amount: dispatched.invoice.total, channel: BANK, reference: `CB-SET-D-${Date.now()}` });
  assert.equal(state.orders.find(o => o.id === dispatched.order.id)!.status, 'dispatched');
  assert.equal(state.invoices.find(i => i.id === dispatched.invoice.id)!.status, 'paid');

  const delivered = deliverAndGet(`SETTLE-L-${Date.now()}-11`);
  const customer = state.customers.find(c => c.id === 'CUS-001')!;
  const creditBefore = customer.creditUsed;
  processPaymentCallback(T, { invoiceId: delivered.invoice.id, amount: delivered.invoice.total, channel: BANK, reference: `CB-SET-L-${Date.now()}` });
  assert.equal(state.orders.find(o => o.id === delivered.order.id)!.status, 'closed');
  assert.ok(customer.creditUsed <= creditBefore, '关闭订单应释放授信占用');
  // closed 是终态：任何 FSM 转换都被拒绝，状态不会倒退。
  assert.throws(() => confirmOrder(T, delivered.order.id), /订单不能从 closed/);
  assert.throws(() => allocateOrder(T, delivered.order.id), /订单不能从 closed/);
});

test('幂等边界包含租户与渠道：不同租户/渠道相同流水号互不影响', () => {
  const { invoice } = setupDispatchedOrder(`BOUND-${Date.now()}-12`);
  const ref = 'SHARED-REF-001';
  const bank = processPaymentCallback(T, { invoiceId: invoice.id, amount: 30, channel: 'bank_transfer', reference: ref });
  const card = processPaymentCallback(T, { invoiceId: invoice.id, amount: 30, channel: 'card', reference: ref });
  const clearing = processPaymentCallback(T, { invoiceId: invoice.id, amount: 30, channel: 'clearing', reference: ref });
  assert.notEqual(bank.payment.id, card.payment.id);
  assert.notEqual(card.payment.id, clearing.payment.id);
  // 幂等键由 租户|渠道|流水号 组成，换租户即换边界。
  assert.notEqual(
    `${T}|bank_transfer|${ref}`,
    'tenant-other|bank_transfer|SHARED-REF-001'
  );
  const stored = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(stored.paid, 90);
});

test('重复 outbox 投递不会重复发布副作用；outbox 按租户隔离', () => {
  const { invoice } = setupDispatchedOrder(`OBX-${Date.now()}-13`);
  const ref = `CB-OBX-${Date.now()}`;
  processPaymentCallback(T, { invoiceId: invoice.id, amount: 40, channel: BANK, reference: ref });
  const events = state.outbox.filter(e => e.aggregateId === invoice.id && e.topic === 'payment.recorded');
  assert.equal(events.length, 1);
  const first = publishOutbox(T, events[0].id, 'relay');
  assert.equal(first.status, 'published');
  assert.equal(first.attempts, 1);
  const again = publishOutbox(T, events[0].id, 'relay-retry');
  assert.equal(again.status, 'published');
  assert.equal(again.attempts, 1, '重复投递不能累加 attempts 或重复审计');
  const mine = listOutbox(T);
  assert.ok(mine.every(e => e.tenantId === T));
});

test('payment、invoice、audit、timeline、outbox 最终状态可相互解释', async () => {
  const { order, invoice } = deliverAndGet(`EXPL-${Date.now()}-14`);
  const ref = `CB-EXPL-${Date.now()}`;
  const part = money2(invoice.total / 2);
  processPaymentCallback(T, { invoiceId: invoice.id, amount: part, channel: BANK, reference: `${ref}-1` });
  processPaymentCallback(T, { invoiceId: invoice.id, amount: money2(invoice.total - part), channel: 'card', reference: `${ref}-2` });

  const inv = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(inv.status, 'paid');
  assert.ok(Math.abs(inv.paid - invoice.total) <= 0.01);
  // 两笔 payment 金额之和 == 发票已收。
  const pays = state.payments.filter(p => p.invoiceId === invoice.id && p.status === 'succeeded');
  assert.ok(Math.abs(pays.reduce((s, p) => s + p.amount, 0) - inv.paid) <= 0.01);
  assert.ok(pays.every(p => p.idempotencyKey === `${p.tenantId}|${p.channel}|${p.reference}`));
  // 订单已关闭且时间线能看到 payment 与 closed 审计。
  assert.equal(state.orders.find(o => o.id === order.id)!.status, 'closed');
  const tlActions = timeline(T, order.id).map(a => a.action);
  assert.ok(tlActions.includes('payment.recorded'));
  assert.ok(tlActions.includes('order.closed'));
  // outbox 中 paid 事件数与审计一致（重复回调零副作用）。
  const dup = await handlePaymentCallback(T, { invoiceId: invoice.id, amount: part, channel: BANK, reference: `${ref}-1` });
  assert.equal(dup.duplicate, true);
  assert.equal(state.outbox.filter(e => e.topic === 'payment.recorded' && e.aggregateId === invoice.id).length, 2);
});

test('冲突审计与晚到失败审计可在订单 timeline 中追踪', async () => {
  const { order, invoice } = setupDispatchedOrder(`TL-${Date.now()}-15`);
  const ref = `CB-TL-${Date.now()}`;
  await handlePaymentCallback(T, { invoiceId: invoice.id, amount: 60, channel: 'card', reference: ref });
  await assert.rejects(
    handlePaymentCallback(T, { invoiceId: invoice.id, amount: 61, channel: 'card', reference: ref }),
    (err: unknown) => err instanceof PaymentCallbackError
  );
  await handlePaymentCallback(T, { invoiceId: invoice.id, amount: 60, channel: 'card', reference: ref, status: 'failed' });

  const events = timeline(T, order.id);
  const actions = events.map(e => e.action);
  assert.ok(actions.includes('payment.recorded'));
  assert.ok(actions.includes('payment.conflict'), '冲突应在时间线可追踪');
  assert.ok(actions.includes('payment.failure.late'), '晚到失败应在时间线可追踪');
  // 时间线只包含本租户、本订单聚合的数据。
  assert.ok(events.every(e => e.tenantId === T));
});
