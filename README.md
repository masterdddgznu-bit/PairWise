# leasepool

进程内资源租约池：基础 createPool / acquire / release / holders 已可运行；需在此基础上迭代实现 TTL 租约与续租、fencing token、steal、事件 Watch、批量 acquire、Compact。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
