# epochmvcc

进程内 **epoch 多版本存储**：快照读针脚、事务写写冲突检测、版本链 GC，以及针脚 TTL。`src/` 为空壳，需从零实现。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
