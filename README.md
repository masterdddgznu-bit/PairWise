# cfgstack

进程内分层配置栈：基础 set/get/delete/list + revision 已可运行；需在此基础上迭代实现 Layer 覆盖、Watch、TTL、事务提交、Snapshot/Restore、Schema 校验与 Compact。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
