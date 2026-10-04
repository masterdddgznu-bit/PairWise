# lagjoin

进程内 **双流滞后关联**：按 key 缓冲左右事件，用水位推进匹配/迟到丢弃/超时单边输出。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
