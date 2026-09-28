# suzuk

进程内 Suzuki–Kasami 令牌互斥：每进程维护 RN 请求序号数组；令牌携带 LN 与等待队列 Q；请求临界区时递增 RN 并向其他进程广播 REQUEST；持有令牌且空闲时按序号转发；退出后更新 LN、入队待满足请求并转发令牌。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
