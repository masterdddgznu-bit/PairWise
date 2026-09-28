# credflow

进程内 peer 间 credit 流控管道：基础 FIFO CreditPipe 已可运行；需在此基础上迭代实现 VirtualClock 驱动的 credit 授予/消费、backlog 队列、TTL 过期 reclaim、reserve/release 与公平 drain。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
