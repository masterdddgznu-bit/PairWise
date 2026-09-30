# floodmax

进程内 FloodMax 图上最大 uid 洪水选举：连通无向图上各节点维护 maxKnown；收到更大值则更新并向邻居继续洪水；收敛后最大 uid 为领袖。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
