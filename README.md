# repliclog

进程内多副本 append-only 复制日志：固定 leader（replica 0）、写 quorum、连续 committed 索引、fail/heal、truncate、export/import。各模块已接好并能跑通单副本/低 quorum 简单路径，quorum/committed/truncate/恢复组合下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
