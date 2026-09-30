# gksketch

进程内确定性 **Greenwald-Khanna** 流式分位数草图（简化可测版）：基础 `ExactSamples` 已可运行；需在此基础上迭代实现 `GKSummary`（tuple 插入与压缩、quantile 查询、merge、export/fromTuples、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
