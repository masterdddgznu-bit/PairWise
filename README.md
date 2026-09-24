# mvcc-kv

进程内多 shard 键值存储：支持 MVCC 事务，并由 Coordinator 跨 shard 做两阶段提交。

`src/` 下的起始实现尚未完成。请使 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
