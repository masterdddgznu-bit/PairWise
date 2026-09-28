# maekawa

进程内 Maekawa 投票互斥：每进程一个投票集（两两相交）；请求临界区时向投票集发 REQUEST；投票者一次只锁给一个请求（按时间戳+pid 排队）；收齐 REPLY 后进入；release 后投票者把票转给队头。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
