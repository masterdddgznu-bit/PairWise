# xorfilter

进程内确定性 **XOR-lite accum filter**（简化可测版，非完整 Graphene/Binary Fuse 论文实现）：基础 `ExactSet` 已可运行；需在此基础上迭代实现 `XorFilter`（FNV 三槽 XOR 累加表、build/contains、merge 逐格 XOR、export/fromTable、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
