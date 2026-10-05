# rankq

进程内 **可老化优先级队列**：按优先级取出；条目在队列中停留足够久后须经 `drive` 提升优先级（每轮每条最多 +1，且有上限）。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
