# dedupttl

进程内 TTL 去重窗口：remember/seen、按过期时刻淘汰、容量满时驱赶最早到期项、VirtualClock 推进批量过期。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
