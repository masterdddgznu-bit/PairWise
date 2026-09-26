# walckpt

进程内分段 WAL：LSN 追加、group commit（VirtualClock 截止）、checkpoint 截断、crash/recover 与校验和。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
