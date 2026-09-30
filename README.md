# epochbarr

进程内分布式 **epoch barrier**：基础 `Barrier` 倒计时已可运行；需在此基础上迭代实现 `EpochBarrier`（成员 propose/ack 推进 epoch、全员到达后释放 wait、join/leave 与 fence、VirtualClock 超时、stale epoch 拒绝）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
