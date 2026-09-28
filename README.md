# chainrep

进程内链式复制：Head 接受写、沿链转发、Tail 提交、读 Tail、节点上下线重配链。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
