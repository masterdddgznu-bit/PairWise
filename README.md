# occval

进程内乐观并发控制（OCC）KV：VirtualClock 分配 startTs / commitTs、事务读集与写集缓冲、提交时 WW / 可选 RS 校验、已提交多版本存储、日志与 export/import 恢复。各模块已接好并能跑通单事务顺序路径，并发校验 / 快照读 / 删除 / 恢复组合下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
