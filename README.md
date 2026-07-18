# FRC Framework

[![CI](https://github.com/DDguan2010/frc-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/DDguan2010/frc-framework/actions/workflows/ci.yml)
[![Release](https://github.com/DDguan2010/frc-framework/actions/workflows/release.yml/badge.svg)](https://github.com/DDguan2010/frc-framework/actions/workflows/release.yml)

FRC Framework 是由 **0.2Studio** 开发的跨平台 FRC Java 项目工作台。它使用可视化结构维护
`project.yaml`，同时生成清晰、普通、可以脱离本软件继续开发的 WPILib Java 代码。

界面支持简体中文和英文，桌面版本支持 Windows、macOS 与 Linux。

## 主要功能

- 创建或打开 WPILib 2026 Command-Based 项目；没有 `project.yaml` 时可从 Java 源码保守导入。
- 可视化维护 Subsystem、Mechanism、设备、CAN ID、参数、Command、控制器绑定和 Auto。
- IronPulse 设备目录提供参数说明、真实硬件/仿真实现和默认 NetworkTables 调参入口。
- Swerve、Limelight、Flywheel、Position Mechanism、Indexer、LED 等开箱即用预制模块。
- 监听外部 Java 修改并增量更新源码树、Command 与 Auto；受管理区域发生冲突时要求人工确认。
- 所有结构化修改先显示文件 Diff，再以事务方式写入 YAML、Java 与英文机器人文档。
- 支持 NT4 参数比较与回写、WPILib 构建/测试/仿真/部署以及外部 IDE、PathPlanner、AdvantageScope。

## 概念速览

- **Subsystem**：WPILib 调度和资源 ownership 的顶层功能系统，例如 Shooter 或 Swerve。
- **Mechanism**：Subsystem 内部的物理功能单元，例如 Shooter Upper、Shooter Lower、Arm Pivot
  或一个 Swerve Module。它用于归组电机、传感器和参数，不一定对应独立 Java Subsystem。
- **Device**：具体电机、编码器、陀螺仪、传感器或相机。
- **Goal**：Subsystem 想达到的目标状态；Command 负责提出目标或组合多个系统动作。

## 安装与使用

从 [Releases](https://github.com/DDguan2010/frc-framework/releases) 下载当前系统的安装包或 ZIP。

1. 启动软件并选择一个文件夹。
2. 空文件夹可以初始化新项目；已有 WPILib 项目会优先读取 `project.yaml`，否则分析 Java。
3. 在左侧项目树添加系统和设备，或从“预制模块”创建完整模块。
4. 检查底部 Diff 后应用修改。
5. 在设置中选择 IDE、PathPlanner 与 AdvantageScope 的自动检测或自定义路径。

完整操作说明见 [中文使用指南](docs/USER_GUIDE.zh-CN.md)。

## 本地开发

需要 Node.js 24 和 pnpm 10：

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm check       # lint、格式、类型、测试和许可证检查
pnpm test:e2e    # 打包并执行 Electron E2E
pnpm make        # 为当前系统生成安装包
```

项目采用 pnpm workspace：桌面程序位于 `apps/desktop`，领域模型、解析、生成、预制与 NT 客户端位于
`packages`，FRC Base 模板和应用图标位于 `resources`。

## 自动发布

仓库管理员可打开 GitHub 的 **Actions → Build and publish release → Run workflow**，只需填写版本号，
例如 `0.2.0`。工作流会在 Windows、macOS、Linux 上验证并构建安装包，生成 SHA-256、SPDX
SBOM 和依赖许可清单，随后创建 `v0.2.0` Tag 与 GitHub Release。

详细签名和发布说明见 [docs/RELEASE.md](docs/RELEASE.md)。

## 安全与代码所有权

生成代码可以在没有 FRC Framework 的环境中正常构建。软件不会静默覆盖外部 Java 修改；Managed
区域冲突需要选择保留代码、比较或重新生成。真实机器人部署、低功率测试和 NT 回写仍需由队伍按机械状态完成安全确认。

## 状态与版权

当前仍为预发布版本。已知限制见 [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)，恢复流程见
[docs/RECOVERY.md](docs/RECOVERY.md)。

Copyright © 2026 0.2Studio. 本仓库目前未声明开源许可证；除非版权所有者另行授权，不自动授予复制、修改或再分发权利。
