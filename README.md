# tarry

进程内 **Tarry 遍历**：连通无向图上令牌沿未使用边前进，仅在无其他未用边时经入口边返回父节点；initiator 收齐后收敛，入口边构成生成树。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
