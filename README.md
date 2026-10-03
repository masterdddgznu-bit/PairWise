# snaplane

进程内 **COW 快照 KV**：head 上 put/get/del 的短路径往往正常；在「快照隔离、从快照分支、TTL 过期、引用计数 GC、同 key 覆盖」组合下会出现串写或误回收。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
