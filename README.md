# shardkv

带 ACL 的分片键值服务：路由、分片参与者、跨分片两阶段提交与门面 API 拆在多个模块里。单分片事务走本地快捷路径，跨分片必须走 2PC。

`src/` 下多个模块仍是空实现。补全后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
