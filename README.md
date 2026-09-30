# cmsketch

进程内确定性 **Count-Min Sketch**：基础 `CounterMap` 已可运行；需在此基础上迭代实现 `CountMinSketch`（多行哈希计数、add/estimate、conservative update、cellwise-sum merge、heavy-hitters 查询、freeze/export）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
