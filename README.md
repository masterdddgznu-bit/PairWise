# granlock

进程内 **多粒度意向锁**：资源树 + IS/IX/S/SIX/X 兼容矩阵、祖先意向自动加锁、冲突等待队列，以及 waits-for 环检测死锁。`src/` 为空壳，需从零实现。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
