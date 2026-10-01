# bloomcnt

进程内确定性 **Counting Bloom Filter**（简化可测版）：基础 `ExactMultiSet` 已可运行；需在此基础上迭代实现 `CountingBloom`（k 路哈希计数槽、add/remove、mightContain、estimateCount 取下界、merge 逐格 max、export/fromCounters、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
