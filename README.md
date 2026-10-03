# quotaring

进程内 **层级 soft/hard 配额环**：节点组成树；`reserve` / `commit` / `release` 用 ticket 占额；`drive` 按 VirtualClock 回收过期预约。单节点短路径往往正常，在「祖先 hard 约束、同 ticket 续约、TTL 边界、部分 commit、reserved 回滚」组合下会不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
