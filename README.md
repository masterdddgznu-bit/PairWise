# fencepool

多租户 fencing-token 租约池：acquire / renew / release、过期窃取、crash 恢复与租户隔离。各模块已接好并能跑通简单路径，边界与组合场景下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
