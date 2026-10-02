# fibheap

进程内确定性 **Fibonacci Heap 最小堆**（简化可测版）：基础 `ExactMap` 已可运行；需在此基础上迭代实现 `FibHeap`（节点句柄、link / cut / cascadingCut / consolidate、decreaseKey、meld、exportState/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
