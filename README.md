# skewtxn

进程内快照隔离事务 KV：基础无事务 put/get 已可运行；需在此基础上迭代实现 begin/read/write/commit、WW 冲突检测，以及 SSI 写偏斜（write skew）检测与中止。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
