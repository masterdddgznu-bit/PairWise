# fencekv

进程内带 fencing token 的租约 KV：基础 put/get/delete 已可运行；需在此基础上迭代实现 VirtualClock 驱动的独占租约、续租/释放，以及带 fence 的 fenced write，拒绝过期租约持有者的 stale 写入。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
