# streamwin

进程内事件时间 tumbling 窗口流处理作业：按 key 聚合、周期性 watermark、迟到侧输出与 checkpoint 恢复。各模块已接好并能跑通简单路径，复杂组合（边界事件、乱序、checkpoint 重放）下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
