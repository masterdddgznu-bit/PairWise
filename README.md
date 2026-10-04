# delaybag

进程内 **延迟袋**：条目带就绪时间；到期后须经 `drive` 晋级到可取队列；`take` 只从就绪队列取；待晋级与就绪各自有容量。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
