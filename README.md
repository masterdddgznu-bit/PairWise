# ownroute

进程内 **键所有权路由**：稳定哈希到 vnode，vnode 归属 owner；通过 propose/prepare/commit/abort 做所有权移交，并用 fence token 拒绝陈旧写。`src/` 为空壳，需从零实现。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
