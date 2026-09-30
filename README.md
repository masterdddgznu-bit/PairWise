# satura

进程内 **树饱和（Saturation）极值选举**：输入必须是树；叶子先发送自身 uid，节点在收齐「除一个邻居外」的消息后向剩余邻居发送当前最大值并饱和，收齐全部邻居后得到全局最大 uid，再广播使全体 online 知晓。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
