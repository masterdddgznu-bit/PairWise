# causalkv

进程内多副本因果一致性 KV：向量时钟、并发 siblings、反熵同步与会话级 read-your-writes / monotonic-reads。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
