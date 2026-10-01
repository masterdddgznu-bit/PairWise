# ghs

进程内 **GHS 风格最小生成树**：带唯一权的连通无向图上，各节点从独立片段出发，经 TEST/ACCEPT/REJECT 找最小对外边（MWOE），再 MERGE 合并片段，直到只剩一个片段。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
