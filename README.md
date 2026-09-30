# spacesave

进程内确定性 **Space-Saving** heavy-hitters 草图：基础 `ExactCounter` 已可运行；需在此基础上迭代实现 `SpaceSaving`（固定容量计数、最小项替换、estimate/guarantee 界、merge、export/fromEntries、freeze）。

迭代完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
