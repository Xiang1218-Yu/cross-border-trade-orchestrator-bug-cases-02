import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateOrder, cancelOrder, closeOrder, confirmOrder, createCustomsDeclaration, createOrder,
  deliverOrder, dispatchOrder, generateInvoice, getOrder, PaymentConflictError, publishOutbox,
  recordPayment, state, timeline, updateCustoms
} from './domain.js';

const TENANT = 'tenant-acme';

// 构造一个已出运、已开票的订单，返回 order/invoice
function setupBilledOrder(reference: string) {
  const order = createOrder(TENANT, {
    customerId: 'CUS-001', reference, origin: '上海', destination: '汉堡',
    items: [{ description: '传感器', sku: 'SENSOR-X9', quantity: 1, unitPrice: 1000, weightKg: 2, hsCode: '9025.19' }]
  });
  confirmOrder(TENANT, order.id, 'tester');
  allocateOrder(TENANT, order.id, 'tester');
  const declaration = createCustomsDeclaration(TENANT, { orderId: order.id });
  updateCustoms(TENANT, declaration.id, { documentRefs: declaration.requiredDocuments, status: 'submitted' }, 'tester');
  updateCustoms(TENANT, declaration.id, { status: 'cleared' }, 'tester');
  dispatchOrder(TENANT, order.id, 'tester');
  deliverOrder(TENANT, order.id, 'tester');
  const invoice = generateInvoice(TENANT, order.id, 'tester');
  return { order, invoice };
}

const snapshotPayments = () => state.payments.length;
const snapshotAudit = () => state.audit.length;
const snapshotOutbox = () => state.outbox.length;

test('相同渠道流水号的重复回调返回同一笔支付且不重复入账', () => {
  const { invoice } = setupBilledOrder(`IDEM-${Date.now()}-1`);
  const ref = `BANK-DUP-${Date.now()}`;
  const first = recordPayment(TENANT, { invoiceId: invoice.id, amount: 300, method: 'bank_transfer', reference: ref }, 'tester');
  assert.equal(first.outcome, 'received');
  assert.equal(first.idempotent, false);

  const invoiceAfterFirst = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(invoiceAfterFirst.paid, 300);
  assert.equal(invoiceAfterFirst.status, 'partially_paid');
  const p0 = snapshotPayments(); const a0 = snapshotAudit(); const o0 = snapshotOutbox();

  // 网络超时导致渠道重试 / 人工补发，内容完全一致
  for (let i = 0; i < 5; i++) {
    const replay = recordPayment(TENANT, { invoiceId: invoice.id, amount: 300, method: 'bank_transfer', reference: ref }, 'tester');
    assert.equal(replay.outcome, 'duplicate');
    assert.equal(replay.idempotent, true);
    assert.equal(replay.payment.id, first.payment.id);
    assert.equal(replay.payment.amount, 300);
  }

  const invoiceFinal = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(invoiceFinal.paid, 300, '已收金额不能被重复回调累加');
  assert.equal(state.payments.length, p0, '不能重复创建 payment');
  assert.equal(state.audit.length, a0, '幂等回放不能重复写审计');
  assert.equal(state.outbox.length, o0, '幂等回放不能重复发 outbox');
  assert.equal(state.paymentKeys.filter(k => k.reference === ref).length, 1, '幂等键唯一');
});

test('幂等边界按租户和渠道隔离', () => {
  const { invoice: invA } = setupBilledOrder(`IDEM-A-${Date.now()}`);
  const { invoice: invB } = setupBilledOrder(`IDEM-B-${Date.now()}`);
  const sharedRef = `SHARED-REF-${Date.now()}`;
  const r1 = recordPayment(TENANT, { invoiceId: invA.id, amount: 100, method: 'bank_transfer', reference: sharedRef }, 'tester');
  // 同租户同流水号但不同渠道，是独立幂等域；但同发票收到两笔 100 仍各自合法（两笔实际到账）
  const r2 = recordPayment(TENANT, { invoiceId: invB.id, amount: 100, method: 'card', reference: sharedRef }, 'tester');
  assert.notEqual(r1.payment.id, r2.payment.id);
  // 同租户同渠道同流水号指向另一张发票 -> 业务内容冲突
  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invB.id, amount: 100, method: 'bank_transfer', reference: sharedRef }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.conflictCode === 'fingerprint_mismatch'
  );
});

test('金额不一致的重复回调被拒绝并留下冲突审计，资金状态不变', () => {
  const { invoice } = setupBilledOrder(`CONF-AMT-${Date.now()}`);
  const ref = `BANK-CONF-A-${Date.now()}`;
  recordPayment(TENANT, { invoiceId: invoice.id, amount: 400, method: 'bank_transfer', reference: ref }, 'tester');
  const paidBefore = state.invoices.find(i => i.id === invoice.id)!.paid;
  const paymentsBefore = snapshotPayments();

  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invoice.id, amount: 401, method: 'bank_transfer', reference: ref }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.conflictCode === 'fingerprint_mismatch'
  );

  const invoiceAfter = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(invoiceAfter.paid, paidBefore);
  assert.equal(state.payments.length, paymentsBefore, '冲突回调不能创建 payment');
  const conflictAudit = state.audit.find(e => e.action === 'payment.conflict');
  assert.ok(conflictAudit, '必须留下可追踪的冲突审计');
  assert.equal(conflictAudit!.entityId, invoice.id, '冲突审计挂在发票上，timeline 可查');
  const key = state.paymentKeys.find(k => k.reference === ref)!;
  assert.equal(key.status, 'conflict');
  assert.ok(key.conflictAuditId);

  // 相同的冲突报文再次重放：仍是冲突拒绝，但不重复刷审计
  const auditCountBefore = snapshotAudit();
  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invoice.id, amount: 401, method: 'bank_transfer', reference: ref }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.idempotent === true
  );
  assert.equal(state.audit.length, auditCountBefore, '相同冲突重放不重复写审计');
});

test('币种不一致、发票已付清超额、订单已取消均拒绝入账', () => {
  const { invoice, order } = setupBilledOrder(`CONF-MIX-${Date.now()}`);
  const total = invoice.total;

  // 币种不一致
  const refCcy = `CCY-${Date.now()}`;
  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invoice.id, amount: 100, currency: 'EUR', method: 'bank_transfer', reference: refCcy }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.conflictCode === 'currency_mismatch'
  );

  // 付清发票
  recordPayment(TENANT, { invoiceId: invoice.id, amount: total, method: 'bank_transfer', reference: `FULL-${Date.now()}` }, 'tester');
  const settled = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(settled.status, 'paid');
  assert.equal(settled.paid, total);
  const refExtra = `EXTRA-${Date.now()}`;
  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invoice.id, amount: 1, method: 'bank_transfer', reference: refExtra }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.conflictCode === 'invoice_already_paid'
  );
  // 已付清后多出来的钱绝不记账，余额不为负也不溢出
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, total);

  // 支付不能直接把订单改成 closed；必须走显式关单
  assert.equal(getOrder(TENANT, order.id).status, 'delivered');
  assert.doesNotThrow(() => closeOrder(TENANT, order.id, 'tester'));
  assert.equal(getOrder(TENANT, order.id).status, 'closed');
});

test('超额部分付款被拒绝时不产生任何副作用', () => {
  const { invoice } = setupBilledOrder(`OVERPAY-${Date.now()}`);
  recordPayment(TENANT, { invoiceId: invoice.id, amount: 50, method: 'bank_transfer', reference: `PART-${Date.now()}` }, 'tester');
  const remaining = Math.round((invoice.total - 50) * 100) / 100;
  const paymentsBefore = snapshotPayments();
  const refOver = `OVER-${Date.now()}`;
  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invoice.id, amount: remaining + 10, method: 'bank_transfer', reference: refOver }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.conflictCode === 'amount_exceeds_balance'
  );
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 50);
  assert.equal(state.payments.length, paymentsBefore);
});

test('并发（同步重入）回调只有一个胜出，其余走幂等回放', () => {
  const { invoice } = setupBilledOrder(`RACE-${Date.now()}`);
  const ref = `RACE-REF-${Date.now()}`;
  const results = Array.from({ length: 8 }, () =>
    recordPayment(TENANT, { invoiceId: invoice.id, amount: 200, method: 'bank_transfer', reference: ref }, 'tester')
  );
  const received = results.filter(r => r.outcome === 'received');
  const duplicates = results.filter(r => r.outcome === 'duplicate');
  assert.equal(received.length, 1);
  assert.equal(duplicates.length, 7);
  assert.ok(duplicates.every(r => r.payment.id === received[0].payment.id));
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 200);
});

test('晚到的失败通知不冲销已入账款项、不回退订单、不触发退款', () => {
  const { invoice, order } = setupBilledOrder(`LATE-FAIL-${Date.now()}`);
  const ref = `LATE-FAIL-REF-${Date.now()}`;
  recordPayment(TENANT, { invoiceId: invoice.id, amount: invoice.total, method: 'bank_transfer', reference: ref }, 'tester');
  closeOrder(TENANT, order.id, 'tester');
  assert.equal(getOrder(TENANT, order.id).status, 'closed');

  const result = recordPayment(TENANT, { invoiceId: invoice.id, amount: invoice.total, method: 'bank_transfer', reference: ref, status: 'failed', failureReason: '渠道事后对账失败' }, 'tester');
  assert.equal(result.outcome, 'conflict');
  assert.equal(result.idempotent, true);
  assert.equal(result.payment.id, state.payments.find(p => p.reference === ref)!.id, '返回规范的那笔成功支付');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.status, 'paid');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, invoice.total);
  assert.equal(getOrder(TENANT, order.id).status, 'closed', '订单状态不能倒退');
  assert.ok(state.audit.find(e => e.action === 'payment.failure_rejected_late'), '晚到失败需留审计');

  // 再次重放失败通知：幂等，不再刷审计
  const auditBefore = snapshotAudit();
  const again = recordPayment(TENANT, { invoiceId: invoice.id, amount: invoice.total, method: 'bank_transfer', reference: ref, status: 'failed' }, 'tester');
  assert.equal(again.outcome, 'conflict');
  assert.equal(state.audit.length, auditBefore);
});

test('先失败后成功（成功通知晚到）：以资金到账为准补入账且只记一次', () => {
  const { invoice } = setupBilledOrder(`FAIL-THEN-OK-${Date.now()}`);
  const ref = `FAIL-OK-REF-${Date.now()}`;
  const failed = recordPayment(TENANT, { invoiceId: invoice.id, amount: 250, method: 'bank_transfer', reference: ref, status: 'failed' }, 'tester');
  assert.equal(failed.outcome, 'failed');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 0, '失败通知不能增加已收金额');
  assert.ok(state.audit.find(e => e.action === 'payment.failed'));

  const recovered = recordPayment(TENANT, { invoiceId: invoice.id, amount: 250, method: 'bank_transfer', reference: ref, status: 'received' }, 'tester');
  assert.equal(recovered.outcome, 'received');
  assert.equal(recovered.payment.id, failed.payment.id, '同一流水号复用同一条 payment 记录，状态翻为 received');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 250);
  assert.equal(state.payments.filter(p => p.reference === ref).length, 1);

  // 再回放成功 -> duplicate，不重复入账
  const replay = recordPayment(TENANT, { invoiceId: invoice.id, amount: 250, method: 'bank_transfer', reference: ref }, 'tester');
  assert.equal(replay.outcome, 'duplicate');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 250);
});

test('失败通知重复投递是幂等的，不产生额外支付或审计', () => {
  const { invoice } = setupBilledOrder(`FAIL-IDEM-${Date.now()}`);
  const ref = `FAIL-IDEM-REF-${Date.now()}`;
  recordPayment(TENANT, { invoiceId: invoice.id, amount: 90, method: 'card', reference: ref, status: 'failed' }, 'tester');
  const a0 = snapshotAudit(); const p0 = snapshotPayments(); const o0 = snapshotOutbox();
  for (let i = 0; i < 3; i++) {
    const r = recordPayment(TENANT, { invoiceId: invoice.id, amount: 90, method: 'card', reference: ref, status: 'failed' }, 'tester');
    assert.equal(r.outcome, 'failed');
    assert.equal(r.idempotent, true);
  }
  assert.equal(state.audit.length, a0);
  assert.equal(state.payments.length, p0);
  assert.equal(state.outbox.length, o0);
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 0);
});

test('部分付款后的订单不能被取消，防止错误退款与订单状态倒退', () => {
  // 走一条只分配未出运的流程：allocated 状态本来可以取消
  const order = createOrder(TENANT, {
    customerId: 'CUS-001', reference: `CANCEL-GUARD-${Date.now()}`, origin: '深圳', destination: '汉堡',
    items: [{ description: '控制模块', sku: 'CONTROL-M2', quantity: 1, unitPrice: 900, weightKg: 2, hsCode: '8537.10' }]
  });
  confirmOrder(TENANT, order.id, 'tester');
  allocateOrder(TENANT, order.id, 'tester');
  const invoice = generateInvoice(TENANT, order.id, 'tester');

  // 收款前可以取消
  assert.doesNotThrow(() => cancelOrder(TENANT, order.id, 'tester'));

  // 再来一单，部分付款后取消必须被拒绝
  const order2 = createOrder(TENANT, {
    customerId: 'CUS-001', reference: `CANCEL-GUARD-2-${Date.now()}`, origin: '深圳', destination: '汉堡',
    items: [{ description: '控制模块', sku: 'CONTROL-M2', quantity: 1, unitPrice: 900, weightKg: 2, hsCode: '8537.10' }]
  });
  confirmOrder(TENANT, order2.id, 'tester');
  allocateOrder(TENANT, order2.id, 'tester');
  const invoice2 = generateInvoice(TENANT, order2.id, 'tester');
  recordPayment(TENANT, { invoiceId: invoice2.id, amount: 100, method: 'bank_transfer', reference: `CANCEL-GUARD-2-${Date.now()}` }, 'tester');
  assert.throws(() => cancelOrder(TENANT, order2.id, 'tester'), /不能直接取消|已有收款/);
  assert.equal(getOrder(TENANT, order2.id).status, 'allocated', '订单状态保持不变');
  assert.equal(state.invoices.find(i => i.id === invoice2.id)!.paid, 100, '已收金额不受取消尝试影响');
  // 付清发票的订单同样不能取消
  const rest = Math.round((invoice2.total - 100) * 100) / 100;
  recordPayment(TENANT, { invoiceId: invoice2.id, amount: rest, method: 'card', reference: `CANCEL-GUARD-FULL-${Date.now()}` }, 'tester');
  assert.throws(() => cancelOrder(TENANT, order2.id, 'tester'), /已有收款/);
  assert.ok(invoice.id);
});

test('重复 outbox 投递：attempts 递增但审计只记一次', () => {
  const { invoice } = setupBilledOrder(`OUTBOX-${Date.now()}`);
  recordPayment(TENANT, { invoiceId: invoice.id, amount: 10, method: 'bank_transfer', reference: `OUTBOX-REF-${Date.now()}` }, 'tester');
  const event = state.outbox.find(e => e.topic === 'payment.received' && e.aggregateId === invoice.id)!;
  assert.ok(event);
  const before = publishOutbox(TENANT, event.id, 'publisher');
  assert.equal(before.status, 'published');
  assert.equal(before.attempts, 1);
  const auditCount = snapshotAudit();
  const second = publishOutbox(TENANT, event.id, 'publisher');
  const third = publishOutbox(TENANT, event.id, 'publisher');
  assert.equal(second.attempts, 2);
  assert.equal(third.attempts, 3);
  assert.equal(second.status, 'published');
  const publishedAudits = state.audit.filter(e => e.action === 'outbox.published' && e.entityId === event.id);
  assert.equal(publishedAudits.length, 1, '重复投递不能重复写发布审计');
  assert.equal(state.audit.length, auditCount);
});

test('订单取消之后到达的收款回调被拒绝，留冲突审计且不记账', () => {
  const order = createOrder(TENANT, {
    customerId: 'CUS-001', reference: `LATE-CANCEL-${Date.now()}`, origin: '深圳', destination: '新加坡',
    items: [{ description: '传感器', sku: 'SENSOR-X9', quantity: 1, unitPrice: 500, weightKg: 1, hsCode: '9025.19' }]
  });
  confirmOrder(TENANT, order.id, 'tester');
  allocateOrder(TENANT, order.id, 'tester');
  const invoice = generateInvoice(TENANT, order.id, 'tester');
  cancelOrder(TENANT, order.id, 'tester');
  assert.equal(getOrder(TENANT, order.id).status, 'cancelled');

  const ref = `LATE-CANCEL-REF-${Date.now()}`;
  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invoice.id, amount: invoice.total, method: 'bank_transfer', reference: ref }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.conflictCode === 'order_cancelled'
  );
  const inv = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(inv.paid, 0);
  assert.equal(inv.status, 'issued');
  assert.ok(state.audit.find(a => a.action === 'payment.conflict' && (a.after as { reason: string }).reason === 'order_cancelled'));
  // 相同报文重放仍是冲突
  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invoice.id, amount: invoice.total, method: 'bank_transfer', reference: ref }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.idempotent === true
  );
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, 0);
});

test('失败后成功恢复时发票已被其他流水号付清：拒绝补入账并记录冲突', () => {
  const { invoice } = setupBilledOrder(`RECOVER-SETTLED-${Date.now()}`);
  const failedRef = `RECOVER-REF-${Date.now()}`;
  recordPayment(TENANT, { invoiceId: invoice.id, amount: 100, method: 'bank_transfer', reference: failedRef, status: 'failed' }, 'tester');
  // 另一笔流水把发票付清
  recordPayment(TENANT, { invoiceId: invoice.id, amount: invoice.total, method: 'card', reference: `OTHER-REF-${Date.now()}` }, 'tester');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.status, 'paid');
  // 迟到的成功通知（金额 100）：不能再入账
  assert.throws(
    () => recordPayment(TENANT, { invoiceId: invoice.id, amount: 100, method: 'bank_transfer', reference: failedRef, status: 'received' }, 'tester'),
    (err: unknown) => err instanceof PaymentConflictError && err.conflictCode === 'invoice_already_paid'
  );
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.paid, invoice.total, '已收金额不能超过总额');
  const failedPayment = state.payments.find(p => p.reference === failedRef)!;
  assert.equal(failedPayment.status, 'failed', '原 payment 保持 failed，不翻成 received');
});

test('payment / invoice / audit / timeline / outbox 最终状态可以相互解释', () => {
  const { invoice, order } = setupBilledOrder(`EXPLAIN-${Date.now()}`);
  const ref = `EXPLAIN-REF-${Date.now()}`;
  const half = Math.round(invoice.total / 2 * 100) / 100;
  recordPayment(TENANT, { invoiceId: invoice.id, amount: half, method: 'bank_transfer', reference: ref }, 'tester');
  const rest = Math.round((invoice.total - half) * 100) / 100;
  recordPayment(TENANT, { invoiceId: invoice.id, amount: rest, method: 'bank_transfer', reference: `EXPLAIN-REF2-${Date.now()}` }, 'tester');

  const inv = state.invoices.find(i => i.id === invoice.id)!;
  assert.equal(inv.status, 'paid');
  assert.equal(Math.round(inv.paid * 100), Math.round(inv.total * 100));

  // payment 金额之和 == invoice.paid
  const paymentSum = state.payments.filter(p => p.invoiceId === invoice.id && p.status === 'received').reduce((s, p) => Math.round((s + p.amount) * 100) / 100, 0);
  assert.equal(Math.round(paymentSum * 100), Math.round(inv.paid * 100));

  // 每笔 received payment 都有对应 audit 与 outbox
  for (const p of state.payments.filter(p => p.invoiceId === invoice.id && p.status === 'received')) {
    assert.ok(state.audit.find(a => a.action === 'payment.received' && (a.after as { payment: { id: string } }).payment.id === p.id));
    assert.ok(state.outbox.find(e => e.topic === 'payment.received' && (e.payload as { paymentId: string }).paymentId === p.id));
  }
  // 付清产生 settled 事件
  assert.ok(state.audit.find(a => a.action === 'invoice.settled' && a.entityId === invoice.id));
  assert.ok(state.outbox.find(e => e.topic === 'invoice.settled' && (e.payload as { invoiceId: string }).invoiceId === invoice.id));

  // timeline 能解释整个订单的收付款过程
  const tl = timeline(TENANT, order.id);
  const actions = tl.map(e => e.action);
  assert.ok(actions.includes('invoice.settled'));
  assert.ok(actions.includes('payment.received'));

  // 付清后允许关单，关单后付款链路状态仍然一致
  closeOrder(TENANT, order.id, 'tester');
  assert.equal(getOrder(TENANT, order.id).status, 'closed');
  assert.equal(state.invoices.find(i => i.id === invoice.id)!.status, 'paid');
});
