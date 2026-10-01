# batchq

多租户批量队列：enqueue、按 `maxBatch` 或 `maxWaitMs` 自动 flush、手动 flush、租户隔离、export/import 崩溃恢复。各模块已接好并能跑通简单路径，边界与组合场景下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
