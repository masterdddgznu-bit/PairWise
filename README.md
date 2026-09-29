# spanjoin

进程内事件时间 **interval join**：基础 `JoinBuffer` 笛卡尔配对已可运行；需在此基础上迭代实现 `SpanJoin`（per-side watermark、join span、迟到侧输出、GC、processing-time earlyFire）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
