# bplustree

进程内确定性 **B+ Tree 有序映射**（简化可测版）：基础 `ExactMap` 已可运行；需在此基础上迭代实现 `BPlusTree`（order m、叶/内节点、插入分裂、删除借位/合并、range 扫描、exportState/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
