# ackbus

带确认与死信队列的进程内消息总线。主题、游标订阅、投递重试、死信和门面拆在多个模块；主干路径已能跑通，边界与异常链路仍有缺口。

补全/修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
