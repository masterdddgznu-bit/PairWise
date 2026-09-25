# quorumkv

进程内的多副本键值服务：读写仲裁、向量时钟冲突、读修复，以及对暂时下线节点的暗示移交。

`src/cluster.ts` 仍是空实现。补全后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
