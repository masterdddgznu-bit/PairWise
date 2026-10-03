# sesswin

进程内 **流式窗口聚合**：按 key 对事件做求和。翻滚窗口（tumbling）基线已可跑；会话窗口、watermark、允许迟到与迟到侧输出、快照恢复等能力尚未接完。

完成 Feature 后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
