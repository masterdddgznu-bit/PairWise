# gammasync

进程内 **Gamma 同步器**：图划分为若干簇；簇内沿生成树做 Beta（UP/DOWN），簇根之间在簇邻接图上做 Alpha（PULSE 握手）。一轮 = 全体簇完成本地 UP + 簇根 α 交换后，再 DOWN 推进脉冲。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
