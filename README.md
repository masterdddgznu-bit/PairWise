# hyperlog

进程内确定性 **HyperLogLog** 基数估计：基础 `ExactSet` 已可运行；需在此基础上迭代实现 `HyperLogLog`（FNV-1a 寄存器更新、alpha_m 估计 + 小范围线性计数、register-max merge、export/fromRegisters、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
