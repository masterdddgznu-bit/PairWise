# maglev

进程内确定性 **Maglev** 一致性哈希查找表（简化可测版）：基础 `ExactBackends` 已可运行；需在此基础上迭代实现 `MaglevTable`（质数槽位、FNV 偏好排列、经典 Maglev 填表、assign 查表、后端变更 rebuild、export/fromState、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
