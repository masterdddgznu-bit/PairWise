# perctx

进程内的 Percolator 风格事务：时间戳预言机、主锁/从锁预写、主键提交，以及读路径上的前滚与回滚清理。

`src/store.ts` 仍是空实现。补全后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
