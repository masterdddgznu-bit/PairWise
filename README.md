# hydralock

进程内层级多粒度锁管理器：基础排他锁（X）已可运行；需在此基础上迭代实现 IS/IX/S/SIX/X 兼容矩阵、路径祖先意图锁、FIFO 等待、死锁检测、超时与整事务释放。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
