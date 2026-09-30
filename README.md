# geninv

进程内 **世代号缓存失效**：基础 `LocalCache` 已可运行；需在此基础上迭代实现 `GenHub`（全局 generation 递增、eager/lazy 失效、stale gen 写拒绝、VirtualClock TTL reap、分片 catch-up 同步）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
