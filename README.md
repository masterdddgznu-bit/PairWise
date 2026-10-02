# mvccssi

进程内 MVCC 快照隔离 + SSI 写偏斜检测：VirtualClock 提交时间戳、多版本存储、事务缓冲、WW/SSI 冲突、日志与 export/import 恢复。各模块已接好并能跑通单事务顺序路径，并发 SI/SSI/删除/恢复组合下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
