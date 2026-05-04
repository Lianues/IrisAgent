# Iris v1.0.14 Release Notes

## Shell 安全黑名单可配置化

* Shell/Bash 工具的硬编码安全黑名单现在可通过 `~/.iris/tools.yaml` 配置关闭
* 当开启 `autoApproveAll: true` 或 `shell/bash.autoApprove: true` 时，自动跳过黑名单检查，允许所有指令运行，不再显示「安全拒绝」
* 未开启时行为不变，黑名单仍正常拦截危险命令
* 更新了工具描述和类型注释，反映新的配置行为
