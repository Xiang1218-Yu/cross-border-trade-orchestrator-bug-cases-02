# Seeded Bug Catalog

This repository is intentionally seeded with ten independent defects on top of the same clean baseline. The normal test suite covers only the original business behavior; each item below is a task package for a later repair round.

## Baseline rules

- Base project: `cross-border-trade-orchestrator`
- Seed branch: `seeded/ten-bugs`
- Every repair should start from this branch and use a separate `fix/bug-xxx-*` branch.
- A valid repair must change at least 10 effective production-code lines, add or update a regression test, and preserve the existing suite.
- Do not solve one bug by rewriting unrelated modules or changing the expected business rule.

## Catalog

| ID | Difficulty | Defect | Primary area |
| --- | --- | --- | --- |
| BUG-001 | Hard | Cancelling an allocated multi-lot order releases only one reservation | inventory / cancellation |
| BUG-002 | Hard | The same payment callback can be booked twice | billing / idempotency |
| BUG-003 | Hard | The order state machine accepts a backwards transition | order lifecycle |
| BUG-004 | Hell | Outbox listing is not tenant-scoped | multi-tenancy / authorization |
| BUG-005 | Hell | Concurrent allocation can reserve more units than available | concurrency / inventory |
| BUG-006 | Hell | A paid invoice closes an order before delivery | payment-order race |
| BUG-007 | Hell | Confirmation changes the order but drops its integration event | transactional outbox |
| BUG-008 | Hard | Customer reference uniqueness is accidentally global | tenancy / constraints |
| BUG-009 | Hell | Cursor pagination is based on a mutable offset and unstable sort | query consistency |
| BUG-010 | Hard | Invoice overdue checks ignore the customer's local timezone | settlement / time |

Each `bugs/BUG-*` directory contains the task prompt, reproduction shape, acceptance criteria, and the expected effective-change threshold. The reproduction specifications are deliberately not wired into `npm test`, so the seeded baseline remains buildable while a repair task is selected.
