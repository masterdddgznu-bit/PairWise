# idembox

幂等发件箱：topic 日志 × 发布幂等窗 × 消费位点，并以 WAL 可恢复。仓库初始不含 `src/`，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
