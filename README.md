# gatebuf

进程内闸门双区缓冲：主队列 / park 队列 / 搬运配额。开闸写入主队列，关闸写入 park；`open`/`drive` 在配额内把 park 灌回主队列。仓库初始不含 `src/`。

## 本地运行

```bash
npm install
npm test
npm run build
```
