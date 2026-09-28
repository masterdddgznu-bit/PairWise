# walidx

进程内带 WAL 的键值库：基础 memtable put/get/delete 已可运行；需在此基础上迭代实现先写日志、checkpoint、崩溃恢复，以及按 value 的二级索引并在恢复后保持一致。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
