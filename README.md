# thetaest

进程内确定性 **Theta Sketch** 基数估计器（简化可测版）：基础 `ExactDistinct` 已可运行；需在此基础上迭代实现 `ThetaSketch`（FNV-1a 哈希、theta 阈值、容量 k 压缩、estimate、merge、export/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
