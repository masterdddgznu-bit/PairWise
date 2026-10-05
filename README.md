# spanlease

进程内半开区间租约：重叠索引检测冲突；冲突时进入等待队列；`release`/`drive` 在重叠消除后按 FIFO 晋升等待者。仓库初始不含 `src/`。

## 本地运行

```bash
npm install
npm test
npm run build
```
