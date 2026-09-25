# sagaeng

进程内 Saga 编排器作业：顺序执行步骤、超时轮、失败/取消补偿、日志重放与幂等恢复。各模块已接好并能跑通简单 happy path；组合超时边界、补偿顺序、crash/recover 与多 saga 并发时行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
