# snapcow

进程内写时复制快照存储：基础 HEAD put/get/delete 已可运行；需在此基础上迭代实现不可变快照、fork 回滚、快照 diff、引用计数 GC 与 VirtualClock TTL 过期。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
