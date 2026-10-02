# segtree

进程内确定性 **区间加 / 区间求和线段树**（带懒标记）：基础 `ExactMap` 已可运行；需在此基础上迭代实现 `SegTree`（固定下标域、4n 容量、lazy add 下推、pullUp、exportState/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
