# shardtxn

跨分片两阶段提交事务协调器：begin/read/write/commit/abort、分片路由、prepare 超时、写冲突与 export/import 恢复。各模块已接好并能跑通单分片简单路径，多分片/超时/冲突/恢复组合下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
