# tokencache

多租户 TTL 缓存：generation token、compare-and-set、singleflight 防击穿、VirtualClock 过期与 GC、export/import 崩溃恢复。各模块已接好并能跑通简单路径，边界与组合场景下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
