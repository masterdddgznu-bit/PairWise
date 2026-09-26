# revstore

进程内修订版 KV 作业：基础 put/get/delete/list 与全局 revision 已可运行；需在此基础上迭代实现 CAS、历史读取、Watch、TTL、多键事务与 Compact。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
