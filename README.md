# authzpol

进程内授权策略引擎：基础 grant / revoke / check（精确角色+资源）已可运行；需在此基础上迭代实现角色继承、通配资源、临时授权、deny 覆盖、事件 Watch、原子事务与 Compact。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
