# BUG-002：重复支付回调造成重复入账

**难度：** Hard  
**基础项目：** cross-border-trade-orchestrator  
**有效生产代码改动下限：** 10 行

## 业务现象

重复支付回调造成重复入账。

## 任务要求

同一租户、同一第三方流水号重复回调时只能产生一笔支付，重复请求应返回既有结果或幂等响应。

请定位根因并完成修复。不能通过删除业务校验、放宽状态约束、跳过测试或只修改注释来解决问题。

## 验收要求

- 新增或修改针对该缺陷的回归测试；
- 原有 
> cross-border-trade-orchestrator@0.1.0 test
> node --import tsx/esm --test src/*.test.ts

✔ order lifecycle preserves credit, inventory, customs, shipment and invoice invariants (0.50225ms)
✔ credit overage creates approval and approval increases only the required limit (0.267583ms)
✔ operation summary exposes receivable and reservation metrics (0.125792ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 47.473875 和 
> cross-border-trade-orchestrator@0.1.0 build
> tsc -p tsconfig.json 继续通过；
- 修复后的有效生产代码改动不少于 10 行；
- 不修改其他 Bug 的预期行为；
- 需要说明并发、租户边界或时间边界（若适用）。
