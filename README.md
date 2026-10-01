# consist

进程内确定性 **一致性哈希环（虚拟节点）**（简化可测版）：基础 `ExactNodes` 已可运行；需在此基础上迭代实现 `ConsistentRing`（FNV 放置 vnode、顺时针 assign、successors、节点增删重建、export/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
