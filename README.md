# abarule

进程内 **Alon–Babai–Itai 极大独立集（MIS）**：n 个顶点在无向简单连通图上，用可注入 PRNG 按度数概率标记，再按 id 决胜加入 MIS，直到剩余子图清空。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
