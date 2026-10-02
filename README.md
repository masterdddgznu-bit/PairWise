# kwcolo

进程内 **Kuhn–Wattenhofer 确定性颜色归约**：n 个顶点在无向简单连通图上，从 id 色出发，每轮把颜色区间按 `2(Δ+1)` 分桶，桶内逐个色类重着色，把调色板上界压到 `Δ+1`。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
