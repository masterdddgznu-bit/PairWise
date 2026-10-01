# reservoir

进程内确定性 **Reservoir Sampling**（简化可测版）：基础 `ExactBag` 已可运行；需在此基础上迭代实现 `Reservoir`（固定容量 k、LCG 随机数、Algorithm R 插入、merge、exportState/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
