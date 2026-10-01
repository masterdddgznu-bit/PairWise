# phaseking

进程内 **Phase King（Berman–Garay）拜占庭共识**：n 个进程（n ≥ 3f+1）在 f+1 个相位上交换提案与国王值，最终就二进制输入达成一致。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
