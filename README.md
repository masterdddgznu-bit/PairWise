# epochgc

进程内 Epoch-Based Reclamation：线程 pin/unpin 世代、retire 延迟回收、bump 推进全局 epoch、crash 注销解除阻塞。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
