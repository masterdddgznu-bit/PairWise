# dedupeq

进程内 **去重 + 毒丸队列**：队内同 id 可原地更新；刚 pop/cancel 的 id 在去重窗内拒收；被 poison 的 id 在毒丸 TTL 内拒收，直至 `clearPoison` 或 `drive` 过期。仓库初始 **不含 `src/`**，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
