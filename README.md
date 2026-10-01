# jumpcon

进程内确定性 **Jump Consistent Hash**（Lamping & Vech 风格，简化可测版）：基础 `ExactBuckets` 已可运行；需在此基础上迭代实现 `JumpHash`（FNV 种子 key→uint64、jump 循环、动态 bucket 数 resize、movedKeys、export/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
