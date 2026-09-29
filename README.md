# changrob

进程内 Chang–Roberts 单向环领袖选举：进程沿环转发 ELECTION；较大 uid 吞掉较小选举消息并可能发起自己的；消息绕回发起者则当选并广播 LEADER。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
