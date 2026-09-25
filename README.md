# pbftx

进程内的 PBFT 风格共识：Pre-Prepare / Prepare / Commit 三阶段、`2f+1` 证书，以及主节点失败后的视图切换。

`src/cluster.ts` 仍是空实现。补全后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
