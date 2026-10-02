# quorumkv

进程内多副本仲裁 KV：N 副本、读写 quorum（R+W>N）、按 key 版本号、陈旧写拒绝、副本 fail/heal、export/import 恢复。各模块已接好并能跑通单副本简单路径，quorum/版本/读修复/恢复组合下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
