# keyflush

进程内 **按 key 合并冲刷**：同 key 后写覆盖；空闲超时后须经 `drive` 冲进就绪队列；`take` 只取就绪。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
