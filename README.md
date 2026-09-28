# tokenring

进程内令牌环互斥：令牌沿环传递、持牌进临界区、VirtualClock 丢牌检测与重生、节点上下线跳过。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
