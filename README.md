# dolev

进程内 **Dolev–Strong 认证广播**：n 个进程、最多 f 个故障，源进程在第 1 轮签名发出值；后续轮次正确进程附上自己的签名链转发；第 f+1 轮结束时按提取规则决定输出。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
