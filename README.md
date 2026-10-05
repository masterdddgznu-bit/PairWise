# slotfill

进程内 **时间槽填充**：写入只进当前 open 槽；槽到期或手动封口后才能按槽序取出；`submit` 不会因时间流逝自动封槽。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
