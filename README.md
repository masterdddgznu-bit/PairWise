# workq

进程内工作队列：基础 enqueue/dequeue/ack/size 已可运行；需在此基础上迭代实现优先级、延迟投递、可见性超时、DLQ、事件 Watch、批量 dequeue、Compact。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
