# alphasync

进程内 **Alpha 同步器**：连通无向图上各节点维护脉冲号；`emit` 向邻居发送当前脉冲的 PULSE；当本脉冲已发出且收齐所有 online 邻居的同号 PULSE 后，脉冲加一。用于在异步消息模型上构造脉冲栅栏。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
