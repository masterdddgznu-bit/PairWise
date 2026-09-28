# hintoff

进程内 Dynamo 风格 sloppy quorum KV：基础单节点 HintStore 已可运行；需在此基础上迭代实现 VirtualClock 驱动的 HintCluster（偏好列表、暗示移交 hinted handoff、读修复 read repair）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
