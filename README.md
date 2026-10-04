# stealq

进程内 **工作窃取队列**：优先领自己的排队；自己空了并空闲足够久才偷别人最老的条目；租约超时回原 owner。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
