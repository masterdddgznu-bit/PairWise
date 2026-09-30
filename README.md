# echowave

进程内 **Echo 波算法**：连通无向图上由 initiator 发出 EXPLORE，首次到达设父并向其余邻居扩展；已访问节点立即 ECHO 回；子树齐后向父 ECHO；initiator 收齐后收敛并形成生成树。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
