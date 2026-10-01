# bracha

进程内 **Bracha 可靠广播**：n 个进程（n ≥ 3f+1）在完全图上交换 INITIAL / ECHO / READY；源进程广播值后，经 Echo / Ready 阈值达成一致投递。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
