# CrossBorder Flow Bug Cases｜跨境供应链履约编排 Bug 基准项目

这是一个独立、可运行的 Node.js + TypeScript 后端项目，包含跨境订单、库存锁定、运输、海关申报、发票收款、审批和 Outbox 事件等业务代码。

本项目与兄弟目录 `../cross-border-trade-orchestrator` 分离：

- 本项目包含预埋 10 个困难业务 Bug 的完整代码；
- `BUGS.md` 和 `bugs/` 只在本项目中保存题目与验收记录；
- 兄弟项目不包含 Bug 题目记录；
- 每道题要求修复前复现、补充回归测试、有效生产代码改动不少于 10 行。

## 启动

```bash
npm install
npm test
npm run build
npm run dev
```

默认监听 `http://localhost:4120`，业务请求需要携带：

```text
x-tenant-id: tenant-acme
```

## 题目记录

- 总览：`BUGS.md`
- 具体题目：`bugs/BUG-xxx-*/task-prompt.md`
- 验收标准：`bugs/BUG-xxx-*/acceptance.md`
