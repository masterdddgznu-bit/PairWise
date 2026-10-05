# twinbuf

进程内 **双缓冲**：写入只进 staging；空闲超时经 `drive` 或手动 `swap` 把 staging 交给 active；`take` 只从 active 取。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
