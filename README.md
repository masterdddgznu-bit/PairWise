# twoplck

进程内严格两阶段锁（Strict 2PL）KV：S/X 锁、FIFO 等待、等待图死锁检测、VirtualClock 锁超时、S→X 升级、已提交存储与事务写缓冲。单事务顺序路径通常正常；并发加锁 / 死锁 / 超时 / 升级组合下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
