# timerwheel

进程内分层时间轮：按 VirtualClock 调度/取消定时器，推进时触发到期任务，高层轮向低层 cascade。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
