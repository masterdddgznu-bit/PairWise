# ageevict

进程内 **TTL + LRU + Pin** 映射：`set`/`get` 维护触碰序；满容时先清过期再逐出未 pin 的最久未触碰项；pin 的 key 不受 LRU 逐出，但仍可因 TTL 过期。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
