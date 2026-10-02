# rbtree

进程内确定性 **Red-Black Tree 有序映射**（简化可测版）：基础 `ExactMap` 已可运行；需在此基础上迭代实现 `RbTree`（红黑着色、CLRS 插入/删除 fixup、旋转、range、exportState/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
