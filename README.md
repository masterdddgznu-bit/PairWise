# lsmkv

进程内的简易 LSM：内存表、不可变刷盘、WAL 与墓碑。崩溃后只重放尚未刷盘的日志。

`src/lsm.ts` 仍是空实现。补全后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
