# wthrow

进程内 **Huang 权重抛掷终止检测**：initiator 持有整数总权重；发 MSG 时对半拆分权重；空闲非根节点将权重 RETURN 给 root；root 在空闲且收回全部权重时宣布终止。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
