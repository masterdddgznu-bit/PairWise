# latewin

进程内事件时间窗口引擎：基础「按到达顺序的最新值」KV 已可运行；需在此基础上迭代实现 watermark、滚动窗口聚合、允许迟到、侧输出、事件幂等，以及 session 窗口合并/关闭。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
