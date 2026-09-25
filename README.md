# flowrun

进程内的工作流引擎：步骤状态机、DAG 依赖、逻辑时钟重试、取消传播、补偿回滚与结果缓存。各模块已经接好并能跑通简单路径，复杂组合场景下行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
