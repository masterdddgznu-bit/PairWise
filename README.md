# leasewheel

进程内 **层级时间轮租约**：按 `tickMs` 推进，把租约挂到环形槽位；到期后可 `pollExpired` 取出。常用路径（短 TTL、单次 schedule）往往正常，在「整圈回绕、同 id 续约、取消后再到期、大跨步 advance、多租约同槽」组合下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
