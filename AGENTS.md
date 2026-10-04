# @itookit/vfs-sync

平台无关的多端同步机制，零运行时包依赖。策略由宿主注入，HTTP 与本地存储由外层适配实现。禁止导入 app-core、会话、VFS 驱动、DOM 或原生宿主模块。

- `contracts.ts`：文件状态、绑定、序列、观察及 I/O 端口。
- `planner.ts`：扫描完整性与纯 B/L/R 比较；缺失须有证据，父操作保护排除项。
- `encoding.ts`：规范 manifest 与 SHA-256；服务端 fixture 兼容。
- `operations.ts`：命令先落盘、序列与查询／取消；pending 不绕过，过期终态须内容对账。
- `file-sync.ts`：持久预览、传输／发布／应用与恢复，不能把云端提交等同于本地应用。
- `resolve.ts`：仅处理确定的文件冲突选择，扫描未知和目录关联组不能普通覆盖。

`pnpm --filter @itookit/vfs-sync test`、`typecheck`、`build` 验证本包。详见 [项目同步设计](https://github.com/mushuanli/itookit/blob/v5.3/doc/design/project-sync.md)。有界文本三方合并已实现；会话同步尚未实现，不把普通文件比较套用到 Round JSON。

独立开发执行 `pnpm typecheck`、`pnpm test`、`pnpm build`。协议 fixture 在 `tests/fixtures/`，来源版本在其 README；不读取主仓库或服务器目录。
