# arlog

进程内的页存储，恢复方式接近 ARIES：允许把未提交的脏页刷出去，也允许提交后先不刷盘。崩溃后只剩日志和已刷盘的页，要靠重做和撤销回到已提交状态。

`src/store.ts` 仍是空实现。补全后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
