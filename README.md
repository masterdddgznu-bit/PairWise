# txoutbox

进程内 Transactional Outbox + Inbox 作业：UnitOfWork 原子写入、按 key 有序投递、可见性超时回收、退避重试与 crash/recover。各模块已接好并能跑通简单 happy path；组合同 key 顺序、超时边界、重复投递去重与恢复时行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
