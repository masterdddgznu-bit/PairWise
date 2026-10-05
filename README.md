# weightwin

进程内 **加权滑动窗口 + 临时加权 + 超限甩载**：窗口内有效权重受 cap 约束；临时 boost 可抬高有效权重并到期；超限时按优先级甩载。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
