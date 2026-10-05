# fairmux

进程内 **多路公平复用**：各 lane 独立 FIFO；`take` 按轮转指针公平取一路队头；空 lane 须跳过；可暂停 lane。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
