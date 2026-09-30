# cuckoofil

进程内确定性 **Cuckoo filter**：基础 `KeyBag` 已可运行；需在此基础上迭代实现 `CuckooFilter`（指纹插入、kick 重定位、lookup/delete、负载因子与 kick 上限失败、事务性回滚、export/fromExport）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
