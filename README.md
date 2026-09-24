# lockmgr

进程内多资源锁管理器：支持共享/排他锁、FIFO 等待队列、死锁检测、锁超时与事务结束后的锁释放。

`src/lock_manager.ts` 为未完成实现。补全后应使 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
