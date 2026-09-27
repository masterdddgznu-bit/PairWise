# merklekv

进程内 Merkle 树键值库：基础 put/get/delete 已可运行；需在此基础上迭代实现 Merkle 根哈希、包含证明、跨副本 LWW 同步 diff，以及带 VirtualClock TTL 的墓碑 GC。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
