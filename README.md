# spillq

进程内 **主队列 + 溢流**：主队列满则进溢流；到期后须经 `drive` 按批回灌主队列；`take` 只从主队列取。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
