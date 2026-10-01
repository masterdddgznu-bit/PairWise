# ratewin

多租户滑动窗口限流器：allow / check、租户与 key 隔离、窗口边界与 burst/refill、export/import 崩溃恢复。各模块已接好并能跑通简单路径，边界与组合场景下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
