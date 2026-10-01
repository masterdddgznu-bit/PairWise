# dsterm

进程内 **Dijkstra–Scholten 终止检测**：initiator 扩散计算，MSG/ACK 与 deficit 计数维护参与树，空闲且 deficit=0 时向父回 ACK；根在空闲且 deficit=0 时宣布终止。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
