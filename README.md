# leadkey

进程内 **按 key 合并执行**：同一 key 同时只有一名 leader，其余等待共享结果；leader 租约到期可把等待者晋升为新 leader；成功/失败都可缓存。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
