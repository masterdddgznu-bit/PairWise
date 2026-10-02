# luby

进程内 **Luby 极大独立集（MIS）**：n 个顶点在无向简单图上，用可注入 PRNG 做多轮随机标记 / 邻居冲突消解，直到活跃集为空。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
