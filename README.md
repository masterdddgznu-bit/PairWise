# twopc

进程内两阶段提交：多参与者 prepare/commit/abort、协调者 journal、VirtualClock 准备超时、coordinator crash/recover。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
