# countsketch

进程内确定性 **Count Sketch** 频率估计器（简化可测版）：基础 `ExactCounter` 已可运行；需在此基础上迭代实现 `CountSketch`（d×w 有符号计数表、update/estimate 中位数、merge、export/fromTable、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
