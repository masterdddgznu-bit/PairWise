# betasync

进程内 **Beta 同步器**：在有根树上，叶子发起 UP(pulse) 汇聚到 root；root 收齐后广播 DOWN，全体脉冲加一。与 Alpha（邻居握手）不同，通信只沿树边。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
