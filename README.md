# lruclock

进程内确定性 **CLOCK / second-chance** 缓存（简化可测版）：基础 `ExactCache` 已可运行；需在此基础上迭代实现 `ClockCache`（环形帧、引用位、hand 指针、get/put/evict、peek、export/import、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
