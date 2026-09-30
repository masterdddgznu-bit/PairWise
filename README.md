# tdigest

进程内确定性 **T-Digest** 流式分位数草图：基础 `SampleBag` 已可运行；需在此基础上迭代实现 `TDigest`（质心压缩、quantile/cdf 查询、merge、export/fromCentroids、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
