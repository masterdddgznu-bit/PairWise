# twinack

进程内 **双端确认写**：同一 key 的写入必须 A/B 两侧都 ack 才可见；超时作废；旧 fence 的迟到 ack 无效。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
