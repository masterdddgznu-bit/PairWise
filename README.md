# lossycnt

进程内确定性 **Lossy Counting** 频繁项算法（简化可测版）：基础 `ExactFreq` 已可运行；需在此基础上迭代实现 `LossyCounter`（窗口桶、delta 插入、estimate/upperBound、prune、merge、export/fromEntries、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
