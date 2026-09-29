# rga

进程内 Replicated Growable Array (RGA) 序列 CRDT：基础单副本字符串文档已可运行；需在此基础上迭代实现 replica 标签、tombstone、并发插入 tie-break、merge、delta 同步与 ACK GC。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
