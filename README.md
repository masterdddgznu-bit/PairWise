# skiplist

进程内确定性 **Skip List 有序映射**（简化可测版）：基础 `ExactMap` 已可运行；需在此基础上迭代实现 `SkipList`（LCG 随机层高、insert/delete/get、range 扫描、exportState/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
