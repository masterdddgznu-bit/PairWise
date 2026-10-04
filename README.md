# spanown

进程内 **半开区间排他占有**：重叠则排队，相邻不冲突；租约到期或释放后按空隙晋升等待者。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
