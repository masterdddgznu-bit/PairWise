# shardbag

进程内 **分片任务袋**：键哈希定片、片内优先级+FIFO、跨片轮询公平 claim、租约 fence、延迟就绪。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
