# cachetie

进程内多级缓存：基础 L1 get/set/delete + LRU 已可运行；需在此基础上迭代实现 L2、TTL、write-through、失效 Watch、singleflight、批量 get、Compact。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
