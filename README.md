# winack

进程内 **发送滑窗**：未确认序号占用窗口；累计 ack 推进；nack/超时经 `drive` 进入重发队列。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
