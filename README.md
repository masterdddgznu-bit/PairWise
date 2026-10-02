# sagarec

确定性的进程内 Saga 编排器：正向步骤、失败重试、逆序补偿、append-only journal、崩溃恢复与状态导入导出。简单顺序路径可运行；重试边界、attempt 幂等、恢复和补偿组合仍有不一致。

修复后应让 `npm test` 与 `npm run build` 全部通过。
