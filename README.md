# rotlease

进程内 **环形租约**：成员按加入顺序排成环；当前持有者持有 fence；到期须经 `drive` 轮转到下一位；`yield` 可主动交棒。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
