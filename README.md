# muxcred

进程内 **多路信用调度**：全局信用按时间补充；请求按 lane 扣费或挂起；`drive` 补充后按轮转公平尽量发放挂起请求。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
