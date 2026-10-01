# rendezvous

进程内确定性 **Rendezvous / Highest Random Weight (HRW)** 哈希（简化可测版）：基础 `ExactRouter` 已可运行；需在此基础上迭代实现 `RendezvousHash`（FNV-1a 分数、加权 pick/topK、export/fromNodes、rebalance 检查、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
