# mattern

进程内 **Mattern 向量时钟终止检测**：n 个进程构成逻辑环传递 PROBE；BASIC 消息携带并合并向量时钟；空闲持探针者按规则累计 delta / black 并转发；initiator 收回探针且 sum=0、!black 时宣布终止。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
