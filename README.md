# avltree

进程内确定性 **AVL 有序映射**（简化可测版）：基础 `ExactMap` 已可运行；需在此基础上迭代实现 `AvlTree`（平衡因子、LL/LR/RR/RL 旋转、插入/删除再平衡、range、exportState/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
