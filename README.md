# viewlog

进程内 **多副本 quorum 日志**：主副本追加、ack 达法定人数连续提交、视图切换截断未提交项，以及状态导出。`src/` 为空壳，需从零实现。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
