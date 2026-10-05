# rotateq

进程内 **多路轮转队列**：各 lane FIFO；`pop` 在有信用的非空 lane 上轮转，并在队头等待超过 `starveMs` 时优先救济；每次成功 `pop` 消耗 1 信用。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
