# simhash

进程内确定性 **SimHash** 近重复指纹（简化可测版）：基础 `ExactBag` 已可运行；需在此基础上迭代实现 `SimHash`（FNV 哈希、逐位累加器、fingerprint、Hamming/similarity、merge、exportAcc/fromAcc、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
