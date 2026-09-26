# rategate

进程内限流网关作业：固定窗口 register/allow/remaining 已可运行；需在此基础上迭代实现 Token Bucket、周期配额、熔断、事件 Watch、原子 batchAllow、refund 与 Compact。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
