# deltamap

进程内 delta-state LWW-Map CRDT：基础单副本 put/get 已可运行；需在此基础上迭代实现逻辑时钟、tombstone、多副本 merge、delta 抽取/应用、ACK 水位与 GC。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
