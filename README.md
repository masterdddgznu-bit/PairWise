# linial

进程内 **Linial 并行 Δ+1 着色**：n 个顶点在无向简单连通图上，用可注入 PRNG 做多轮随机重着色，直到相邻异色且调色板 ≤ Δ+1。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
