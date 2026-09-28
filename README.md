# orset

进程内 Observed-Remove Set (OR-Set) CRDT：基础单副本 Set 已可运行；需在此基础上迭代实现 replica 标签、tombstone、add-wins merge、delta 抽取/应用、ACK 水位与 GC。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
