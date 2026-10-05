# leasebank

进程内 **槽位租约池 + 等待队列 + 亲和性**：空闲槽按亲和性优先再取最小编号；满则 FIFO 等待；`release` 把刚释放槽交给队头；到期必须 `drive` 后才过期并晋升。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
