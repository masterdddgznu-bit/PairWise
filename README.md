# bloomrec

进程内确定性 Bloom-filter **集合对账**：基础 `KeySet` 已可运行；需在此基础上迭代实现 `BloomFilter`、`Replica` 摘要/对账/同步，以及 IBLT-lite `Sketch` 精确缺键恢复。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
