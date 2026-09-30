# minhash

进程内确定性 **MinHash** Jaccard 相似度估计器（简化可测版）：基础 `ExactSet` 已可运行；需在此基础上迭代实现 `MinHash`（k 路哈希签名、estimate/merge、export/fromSignature、LSH similarityBand、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
