# tierq

进程内 **多层就绪队列 + 晋级策略 + 冷却登记**：新项进 tier 0；`drive` 按年龄与层内门槛晋级；`pop` 后 id/tenant 进入冷却，阻挡重入队与再晋级。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
