# beno

进程内 **Ben-Or 随机化拜占庭二进制共识**：n 个进程（n ≥ 5f+1 的简化同步模型）在多轮 R/BV 交换与可注入 PRNG 下达成一致。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
