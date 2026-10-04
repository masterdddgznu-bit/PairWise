# holdpin

进程内 **按 key 持有锁**：空闲则立即持有；被占则进入等待队列；租约超时须经 `drive` 过期并转交给队头等待者。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
