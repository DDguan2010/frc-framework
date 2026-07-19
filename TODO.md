# FRC Framework 详细 TODO

> 本清单配合 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) 使用。
> 状态标记：`[ ]` 未开始、`[-]` 进行中、`[x]` 完成、`[!]` 阻塞。
> 优先级：P0 必须、P1 重要、P2 后续增强。

## 0. 完成定义

一项任务只有同时满足以下条件才可标记完成：

- 实现已经合并，不只是原型或设计稿；
- 类型检查、lint 和相关测试通过；
- 新增用户文本包含中英文翻译；
- 文件读写、进程调用和 IPC 已完成错误处理；
- 对应功能有至少一个正常用例和一个失败用例；
- 会影响项目输出时，已验证 Diff、撤销和崩溃恢复；
- 会生成 Java 时，至少一个 fixture 通过 Spotless 和 Gradle compile；
- 关键行为已更新开发文档或 ADR。

## 1. 里程碑总览

| 里程碑 | 交付结果 | 依赖 |
| --- | --- | --- |
| M0 技术验证 | 关键技术风险有可运行结论 | 无 |
| M1 Desktop Shell | Electron 桌面壳、Material 3、双语可运行 | M0 |
| M2 Project Core | YAML、事务、Diff、监听和恢复可用 | M1 |
| M3 Base & Generator | 可创建并编译优化 Base | M2 |
| M4 Structured Robot | 可视化创建层级 Subsystem 和电机 | M3 |
| M5 Code Collaboration | 可导入、识别、跳 IDE 和安全编辑引用 | M4 |
| M6 Controls & Commands | 多设备绑定和 Command 装配闭环 | M5 |
| M7 Presets | Swerve、Limelight 可创建和维护 | M6 |
| M8 NT Tuning | NT 差异回写代码闭环 | M4、M5 |
| M9 Workflow Complete | Docs、验证、Build/Sim/Deploy 完整 | M6、M8 |
| M10 Beta Release | 三平台安装包和 Beta 验收 | M9 |

## 2. M0：仓库与技术验证

### 2.1 仓库初始化

- [x] **M0-001 P0** 初始化 pnpm workspace，锁定 Node.js LTS 和 pnpm 版本。
- [x] **M0-002 P0** 使用 Electron Forge + Vite + TypeScript strict 创建 `apps/desktop`。
- [x] **M0-003 P0** 建立 `packages/*`、`resources/*`、`docs/adr/*` 目录。
- [x] **M0-004 P0** 配置 ESLint、Prettier、EditorConfig、typecheck 和统一脚本。
- [x] **M0-005 P0** 建立 Vitest、Playwright 和测试 fixture 基础设施。
- [x] **M0-006 P0** 配置提交前检查，但保证 CI 可独立执行全部检查。
- [x] **M0-007 P1** 建立 Conventional Commits/Changelog 规则。
- [x] **M0-008 P1** 添加第三方依赖许可清单和自动审计脚本。

**验收：** 新克隆仓库后，一条安装命令和一条开发命令能打开空 Electron 窗口；typecheck、lint、unit test 均可运行。

### 2.2 Material Design 3 技术验证

- [x] **M0-020 P0** 安装并固定 `@material/web` 精确版本。
- [x] **M0-021 P0** 用 Lit 渲染 Button、Text Field、Select、Checkbox、Tabs、Dialog、Menu；因 Material Web 2.5 无 Snackbar，按 ADR 0001 使用 Material token `aria-live` 状态面。
- [x] **M0-022 P0** 建立 `ui/material` 薄适配入口，禁止业务层自行封装另一套视觉系统。
- [x] **M0-023 P0** 定义黑/灰/白 Material tokens：surface、surface-container、outline、on-surface。
- [x] **M0-024 P0** 验证 Material Symbols 和字体可离线打包。
- [x] **M0-025 P0** 制作三栏工作区原型：Navigation Rail、主内容、Inspector、底部面板。
- [x] **M0-026 P0** 验证键盘焦点、屏幕阅读器标签、缩放和高对比度。
- [x] **M0-027 P1** 验证 1280×720、1920×1080 和高 DPI 下的布局。
- [x] **M0-028 P0** 写 ADR：Material Web 维护模式、锁版和未来替换边界。

**验收：** 原型不使用第三方 UI 组件库；标准交互控件全部来自 `@material/web`；断网时视觉和图标完整。

### 2.3 Electron 安全与跨平台验证

- [x] **M0-040 P0** 建立 Main/Preload/Renderer 三层和共享 IPC 类型。
- [x] **M0-041 P0** 设置 `contextIsolation: true`、`nodeIntegration: false`、Renderer sandbox。
- [x] **M0-042 P0** 设置 CSP，禁止无必要的远程内容和动态代码执行。
- [x] **M0-043 P0** 实现最小 `contextBridge` 示例，不暴露通用 `ipcRenderer`。
- [x] **M0-044 P0** 实现目录选择和授权根路径验证原型。
- [x] **M0-045 P0** 验证 `spawn` 参数数组调用，不使用 `shell: true`。
- [x] **M0-046 P0** 在 Windows、macOS、Linux CI 启动 packaged smoke test。
- [x] **M0-047 P0** 写 ADR：IPC、路径授权、外部程序调用安全模型。

**验收：** Renderer 无法直接 `require('fs')`；越出授权项目根目录的 IPC 请求被 Main 拒绝并记录原因。

### 2.4 Java 分析技术验证

- [x] **M0-060 P0** 用 Tree-sitter Java WASM 解析现有 base 和 10541 项目代表性文件。
- [x] **M0-061 P0** 提取 package、imports、classes、fields、constructors、methods 和源码范围。
- [x] **M0-062 P0** 对不完整和暂时编译错误的 Java 验证容错能力。
- [x] **M0-063 P0** 识别 IronPulse 常见 Motor Config/Factory/Subsystem 构造链。
- [x] **M0-064 P0** 识别 WPILib `Trigger`/Controller/Command binding 常见写法。
- [x] **M0-065 P0** 验证 import 插入、去重、排序和 static import。
- [x] **M0-066 P0** 定义 Managed/Recognized/Custom 分类和置信度数据结构。
- [x] **M0-067 P0** 写 ADR：parser、targeted edit 和 managed region 策略。

**验收：** 对选定 fixture 能产生稳定 JSON 索引；存在复杂表达式时不崩溃，且明确返回 Custom 源码范围。

### 2.5 NT4 技术验证

- [x] **M0-080 P0** 调研 WPILib NT4 协议、可用 Node/WASM 实现和跨平台打包风险。
- [x] **M0-081 P0** 研究 AdvantageScope 的连接交互、地址处理和重连体验。
- [x] **M0-082 P0** 完成依赖许可检查，不复制许可不兼容的实现代码。
- [x] **M0-083 P0** 制作连接本地 simulator、订阅指定 prefix、读取基本类型的 spike。
- [x] **M0-084 P0** 验证写值、断线重连、类型变化和超时。
- [x] **M0-085 P0** 定义 `NtClient` 接口，使协议实现可替换。
- [x] **M0-086 P0** 写 ADR：NT 客户端选择和协议测试方案。

**验收：** Windows、macOS、Linux 至少能通过相同接口运行协议测试；若无法做到，必须在 M0 明确替代实现，不把风险推迟到 M8。

### 2.6 WPILib 工具链验证

- [x] **M0-100 P0** 在三平台调研 WPILib JDK 和工具安装位置。
- [x] **M0-101 P0** 检测系统 Java 与 WPILib JDK，建立选择优先级。
- [x] **M0-102 P0** 用 Node `spawn` 运行 `gradlew tasks`、compile 和 simulate dry-run。
- [x] **M0-103 P0** 解析 Gradle error 的文件、行、列和 message。
- [x] **M0-104 P0** 验证进程取消、超时、退出码和流式日志。
- [x] **M0-105 P0** 写 ADR：Toolchain discovery 和平台命令抽象。

**验收：** 系统 Java 不兼容时可自动选择 WPILib JDK，并在 UI 数据模型中给出明确诊断。

## 3. M1：Desktop Shell 与基础体验

### 3.1 应用外壳

- [x] **M1-001 P0** 实现 Top App Bar、Navigation Rail、Workspace、Inspector、Bottom Panel。
- [x] **M1-002 P0** 实现可调整宽度的树/内容/Inspector 分栏。
- [x] **M1-003 P0** 保存窗口尺寸、位置、分栏和面板展开状态。
- [x] **M1-004 P0** 建立统一的 Command Palette/快捷操作模型。
- [x] **M1-005 P0** 建立全局 Snackbar、Dialog、错误边界和 loading 状态。
- [x] **M1-006 P1** 添加键盘快捷键帮助页。
- [x] **M1-007 P1** 支持紧凑密度设置，但不破坏 Material 最小点击区域。
- [x] **M1-008 P1** 应用启动窗口适配当前显示器完整可用工作区，多显示器不越界。
- [x] **M1-009 P1** 接入统一 SVG 品牌源并生成 Windows/macOS/Linux 应用图标。

### 3.2 首页与项目入口

- [x] **M1-020 P0** 首页显示 Create、Open、Recent Projects。
- [x] **M1-021 P0** 选择目录后判断为空目录、有效项目或未知目录。
- [x] **M1-022 P0** 空目录显示创建表单，非空目录默认显示打开/导入预览。
- [x] **M1-023 P0** Recent Projects 记录路径、显示名、最后打开时间和失效状态。
- [x] **M1-024 P0** 支持从系统文件关联或命令行路径打开项目。
- [x] **M1-025 P1** 支持拖入项目目录。
- [x] **M1-026 P0** 最近项目不存在或无权限时提供移除/重新定位。

### 3.3 中英文国际化

- [x] **M1-040 P0** 建立 `en`、`zh-CN` 翻译资源和 typed translation keys。
- [x] **M1-041 P0** 首次启动跟随系统语言。
- [x] **M1-042 P0** 设置中可即时切换语言，无需重启。
- [x] **M1-043 P0** 日期、数值、单位和复数使用 Intl API。
- [x] **M1-044 P0** 增加测试，阻止缺失 key 和 Renderer 硬编码用户文本。
- [x] **M1-045 P1** 检查中英文文本长度变化下的布局。

### 3.4 设置与编辑器

- [x] **M1-060 P0** 设置页保存主题、语言、项目默认值和日志级别。
- [x] **M1-061 P0** 检测 WPILib VS Code、VS Code、IntelliJ IDEA、Cursor。
- [x] **M1-062 P0** 支持自定义可执行文件和参数模板。
- [x] **M1-063 P0** 支持 `{file}`、`{line}`、`{column}`、`{project}` 占位符。
- [x] **M1-064 P0** 验证 executable，使用数组参数和 `shell: false`。
- [x] **M1-065 P0** 建立“测试打开”功能。
- [x] **M1-066 P1** 支持每项目覆盖默认编辑器。
- [x] **M1-067 P0** AdvantageScope、PathPlanner 支持自动检测与每应用自定义路径。
- [x] **M1-068 P0** 支持 Windows Microsoft Store PathPlanner 与 macOS `.app` 选择。

**M1 验收场景：** 用户首次启动无需教程，能从首页选择文件夹、理解创建/打开状态、切换语言，并从设置测试打开外部 IDE。

## 4. M2：Project Model、YAML 与事务引擎

### 4.1 Schema 与模型

- [x] **M2-001 P0** 定义 `schemaVersion: 1` 顶层 JSON Schema。
- [x] **M2-002 P0** 定义 Project、Robot、Subsystem、Mechanism、Device、Controls、Commands、NT、Docs 实体。
- [x] **M2-003 P0** 每个实体使用稳定 UUID，Java symbol 作为可变属性。
- [x] **M2-004 P0** 为参数定义 type、unit、default、range、condition、source。
- [x] **M2-005 P0** 实现 YAML parse/stringify，输出顺序和注释策略稳定。
- [x] **M2-006 P0** 友好显示 Schema 错误到 YAML 路径和 UI 对象。
- [x] **M2-007 P0** 建立未知字段保留策略，避免新版本数据被旧版本静默丢弃。
- [x] **M2-008 P0** 实现 Schema migration runner 和备份。
- [x] **M2-009 P0** 生成 `project.schema.json` 供外部编辑器提示。

### 4.2 领域命令与历史

- [x] **M2-020 P0** 所有结构化修改通过 typed domain command 执行。
- [x] **M2-021 P0** 实现 add/remove/move/rename/update/batch commands。
- [x] **M2-022 P0** 每个命令返回 touched entities 和预计输出文件。
- [x] **M2-023 P0** 实现 undo/redo，跨 YAML 和生成文件保持一致。
- [x] **M2-024 P0** 保存当前 session 的操作历史和 clean checkpoint。
- [x] **M2-025 P1** 支持将多个 Inspector 修改合并为一个可撤销操作。

### 4.3 Diff 与事务写入

- [x] **M2-040 P0** 建立候选输出目录，不直接覆盖项目。
- [x] **M2-041 P0** 计算新增、修改、删除、重命名文件 Diff。
- [x] **M2-042 P0** 实现行级 Diff viewer 和文件筛选。
- [x] **M2-043 P0** 高亮 Managed、Recognized、Custom 区域。
- [x] **M2-044 P0** 实现临时文件、fsync/close、同目录原子 rename。
- [x] **M2-045 P0** 写入前保存事务 manifest 和可恢复备份。
- [x] **M2-046 P0** 模拟写到一半进程退出并验证下次启动恢复。
- [x] **M2-047 P0** 实现事务应用失败的完整 rollback。
- [x] **M2-048 P1** 实现“自动应用安全修改”设置，仍写入历史。

### 4.4 文件监听与并发修改

- [x] **M2-060 P0** 用 Chokidar 监听 YAML、Java、Gradle、vendordeps 和 docs。
- [x] **M2-061 P0** 区分应用自身写入和外部写入。
- [x] **M2-062 P0** 合并短时间内的编辑器临时文件/rename 事件。
- [x] **M2-063 P0** 当前 UI 有未保存候选变更时，外部修改触发冲突提示。
- [x] **M2-064 P0** 提供 reload、compare、keep external、regenerate 四类明确操作。
- [x] **M2-065 P0** 测试 VS Code、IntelliJ 常见安全保存模式。

### 4.5 项目授权与锁

- [x] **M2-080 P0** Main 保存当前授权项目根目录。
- [x] **M2-081 P0** 所有文件 IPC 使用 canonical path 校验，防止 `..` 和 symlink 越界。
- [x] **M2-082 P0** 建立应用实例/项目写锁，检测同项目被两个窗口修改。
- [x] **M2-083 P0** 支持只读打开和“取得写入权”。
- [x] **M2-084 P1** 检测项目是否位于网络盘或同步盘并提示原子性风险。

**M2 验收场景：** 修改模型后能先看 Diff，再同时更新 YAML 和一个 fixture 文件；强制杀掉应用后重新打开能恢复或回滚到一致状态。

## 5. M3：优化 Base 与生成器

### 5.1 分析现有代码资产

- [x] **M3-001 P0** 记录 `frc-code-base` 的包结构、IronPulse 封装、Gradle 和 vendordeps。
- [x] **M3-002 P0** 记录 `2026-offseason-robot-10541` 的 Robot 生命周期、Container、OI、Auto、Telemetry、Subsystem 模式。
- [x] **M3-003 P0** 列出可直接复用、需重构、不可进入 Base 的文件。
- [x] **M3-004 P0** 确认所有复用代码的版权和许可。
- [x] **M3-005 P0** 为新 Base 写结构 ADR。

### 5.2 Base 工程

- [x] **M3-020 P0** 新建唯一 `resources/base-template`，不直接复制当前 base 成品。
- [x] **M3-021 P0** 创建最小 `Main`、`Robot`、`RobotContainer`、`RobotConstants`。
- [x] **M3-022 P0** 创建空 `OperatorInterface` 和 controller provider 边界。
- [x] **M3-023 P0** 创建空 `RobotCommands`。
- [x] **M3-024 P0** 创建 AutoManager/Actions/Routines/Params 骨架。
- [x] **M3-025 P0** 创建 Telemetry 和 Field 骨架。
- [x] **M3-026 P0** 放入/连接 `lib.ironpulse` 所需源码和构建配置。
- [x] **M3-027 P0** 正确配置 `src/ext` 和 NT annotation processor。
- [x] **M3-028 P0** 配置 AdvantageKit、Phoenix、PathPlanner 基础依赖。
- [x] **M3-029 P0** 配置 Spotless 和标准 GradleRIO 任务。
- [x] **M3-030 P0** 确保没有 Swerve、Limelight 或具体机器人设备。
- [x] **M3-031 P0** 空项目在 Real/Sim 配置下编译。

### 5.3 创建向导

- [x] **M3-040 P0** 收集 project name、team number、package、WPILib year。
- [x] **M3-041 P0** 检查空目录并防止覆盖现有文件。
- [x] **M3-042 P0** 实例化 Base 中的模板变量。
- [x] **M3-043 P0** 生成初始 `project.yaml` 和 Schema 引用。
- [x] **M3-044 P0** 生成唯一 `AGENTS.md` 和核心英文 docs。
- [x] **M3-045 P0** 创建完成自动运行 validation、Spotless、compile。
- [x] **M3-046 P0** 失败时显示日志并完整撤销已创建文件。

### 5.4 确定性生成器

- [x] **M3-060 P0** 建立 TypeScript generator API 和 template context。
- [x] **M3-061 P0** 固定文件、import、字段、方法和 YAML 输出顺序。
- [x] **M3-062 P0** 生成前检查 Java identifier 和 package path。
- [x] **M3-063 P0** 生成后运行 Spotless 并重新计算最终 Diff。
- [x] **M3-064 P0** 同一模型连续生成两次，第二次必须零 Diff。
- [x] **M3-065 P0** 建立 golden snapshots 和 Gradle compile 测试。

**M3 验收场景：** 在空目录创建项目，生成代码肉眼清晰，`RobotContainer` 保持精简，不安装 FRC Framework 也能用 WPILib 工具构建。

## 6. M4：结构化 Robot、Subsystem 与硬件

### 6.1 双项目树

- [x] **M4-001 P0** 实现逻辑树和源码树切换。
- [x] **M4-002 P0** 逻辑树支持 Robot → Subsystem → Mechanism → Device/Command/State。
- [x] **M4-003 P0** 支持 Superstructure 和非硬件 helper 节点。
- [x] **M4-004 P0** 支持搜索、折叠、键盘导航和右键/更多菜单。
- [x] **M4-005 P0** 支持拖动调整 Mechanism/Device 层级，显示合法落点。
- [x] **M4-006 P0** 源码树标记 Managed/Recognized/Custom、外部修改和问题数量。
- [x] **M4-007 P1** 保存每项目的树展开状态。

### 6.2 IronPulse 组件目录

- [x] **M4-020 P0** 盘点 `lib.ironpulse` 可生成的所有 MotorIO、SubsystemConfig、Real/Sim 类。
- [x] **M4-021 P0** 为 TalonFX 主电机和 follower 建立 catalog definition。
- [x] **M4-022 P0** 为 Position/Velocity MotorSubsystem 建立 definition。
- [x] **M4-023 P0** 为 CANcoder、Gyro、BeamBreak、Indicator 等建立基础 definition。
- [x] **M4-024 P0** 每个参数记录类型、单位、范围、默认、依赖、互斥和生成映射。
- [x] **M4-025 P0** 建立组件目录 Schema 和版本号。
- [x] **M4-026 P0** catalog 的每个 generator mapping 有 fixture 测试。
- [x] **M4-027 P1** UI 显示对应 IronPulse 类型和说明链接。

### 6.3 Subsystem/Mechanism/Device 编辑器

- [x] **M4-040 P0** 新建 Subsystem 向导：名称、模式、package、Real/Sim。
- [x] **M4-041 P0** 新建 Mechanism：逻辑名称、Java symbol、说明。
- [x] **M4-042 P0** 新建设备：类型、ID/bus、role 和显示名。
- [x] **M4-043 P0** Inspector 默认显示必要与常用参数。
- [x] **M4-044 P0** “添加参数”支持搜索高级参数和类别筛选。
- [x] **M4-045 P0** 未选择的可选参数不生成 Builder 调用。
- [x] **M4-046 P0** 支持 follower 列表、独立 ID、方向和主设备关联。
- [x] **M4-047 P0** 支持 setpoint 列表和有单位的值。
- [x] **M4-048 P0** 支持 Real/Sim 参数并在树中标明缺失实现。
- [x] **M4-049 P0** 删除设备时显示受影响引用和代码文件。

### 6.4 首批参数覆盖

- [x] **M4-060 P0** CAN ID、bus、inversion、neutral mode。
- [x] **M4-061 P0** follower 和 oppose direction。
- [x] **M4-062 P0** supply/stator current limits。
- [x] **M4-063 P0** open/closed loop ramps。
- [x] **M4-064 P0** sensor/mechanism ratios、remote CANcoder、feedback source。
- [x] **M4-065 P0** forward/reverse soft limits 和 zero/home。
- [x] **M4-066 P0** PID slots、kP/kI/kD。
- [x] **M4-067 P0** kS/kV/kA/kG 和 gravity type。
- [x] **M4-068 P0** Motion Magic velocity/acceleration/jerk。
- [x] **M4-069 P0** tolerance、continuous wrap、custom setpoints。
- [x] **M4-070 P0** Sim inertia、gearing、friction、bounds。
- [x] **M4-071 P0** 每项支持“发布到 NT/允许调节”和路径覆盖。

### 6.5 核心验证器

- [x] **M4-080 P0** CAN/DIO/Analog/PWM/USB port 冲突。
- [x] **M4-081 P0** Java name/package 冲突和非法字符。
- [x] **M4-082 P0** 参数单位、范围、上下限和 ratio 校验。
- [x] **M4-083 P0** follower 环、主设备不存在和总线不一致。
- [x] **M4-084 P0** NT path 冲突、类型冲突和非法路径。
- [x] **M4-085 P0** Real 缺少 Sim fallback。
- [x] **M4-086 P0** 问题能定位到树节点、Inspector 字段和生成源码。
- [x] **M4-087 P1** 对确定性问题提供 Quick Fix。

**M4 验收场景：** 能表示 Shooter → Upper/Lower/Hood → 多个主从电机；修改任意设备参数后 YAML、Java、硬件文档同步，冲突会在写入前阻止。

## 7. M5：代码索引、导入与 IDE 协作

### 7.1 打开现有项目

- [x] **M5-001 P0** 检测 `project.yaml` 并优先加载。
- [x] **M5-002 P0** 校验 Schema/Base/Preset 版本并显示迁移预览。
- [x] **M5-003 P0** 无 YAML 时识别 GradleRIO、WPILib year、team、package、vendordeps。
- [x] **M5-004 P0** 建立 Java 索引并识别标准 IronPulse 结构。
- [x] **M5-005 P0** 生成导入预览：Recognized、Partial、Custom。
- [x] **M5-006 P0** 用户确认后只创建 YAML/docs，不重写未知 Java。
- [x] **M5-007 P0** 导入报告列出未识别内容和源码位置。
- [x] **M5-008 P0** 用 10541 完整项目建立回归 fixture。
- [x] **M5-009 P0** 重载 Command 使用参数签名生成唯一 ID，并提供旧导入修复脚本。

### 7.2 源码索引

- [x] **M5-020 P0** 索引文件、类型、字段、构造函数、方法、imports。
- [x] **M5-021 P0** 记录 AST range 到行/列的映射。
- [x] **M5-022 P0** 识别 managed regions 和文件所有权。
- [x] **M5-023 P0** 识别 Command 返回方法、requirements 和参数。
- [x] **M5-024 P0** 识别 Controller、Trigger 和 binding。
- [x] **M5-025 P0** 识别 enum Goal/State 与简单 setter。
- [x] **M5-026 P0** 增量解析变更文件，不全项目重复扫描。
- [x] **M5-027 P0** Parser error 不影响其他文件使用。

### 7.3 代码操作

- [x] **M5-040 P0** 从任何索引对象打开外部编辑器到准确行列。
- [x] **M5-041 P0** 添加普通 import 和 static import，自动去重排序。
- [x] **M5-042 P0** “添加类引用”生成字段和构造参数。
- [x] **M5-043 P0** 在 RobotContainer 添加对应依赖注入。
- [x] **M5-044 P0** 跨 Subsystem 引用前显示依赖图和所有文件 Diff。
- [x] **M5-045 P0** 检测循环依赖并建议 RobotCommands/Superstructure。
- [x] **M5-046 P0** 生成局部 Goal/State enum、字段、getter/setter。
- [x] **M5-047 P0** 可选生成 `setGoalCommand` 和 AdvantageKit logging。
- [x] **M5-048 P0** 支持 Direct/Goal-driven/Custom Java 模式切换预览。
- [x] **M5-049 P0** 不生成新的通用状态机依赖。

### 7.4 外部修改适配

- [x] **M5-060 P0** Recognized 标准变更可建议同步回 YAML。
- [x] **M5-061 P0** 复杂表达式显示源码摘要和“在代码中调试”。
- [x] **M5-062 P0** 修改 Managed 文件时显示模型/代码双向冲突。
- [x] **M5-063 P0** 支持 keep code and unmanage。
- [x] **M5-064 P0** 支持 regenerate from model，但必须二次确认 Diff。
- [x] **M5-065 P0** 测试用户在 managed region 外增加方法不会丢失。

**M5 验收场景：** 打开无 YAML 的 10541 fixture 后能显示 Shooter 层级和 Custom 内容；给一个 Subsystem 添加另一个类引用时生成正常 import/构造注入，并能一键跳 IDE。

## 8. M6：Controls、Commands 与装配

### 8.1 输入设备

- [x] **M6-001 P0** 支持 Xbox、PS4/PS5、Joystick、GenericHID。
- [x] **M6-002 P0** 支持 Button Board 和自定义按钮/轴布局。
- [x] **M6-003 P1** 支持 Sim Keyboard 和 NT input。
- [x] **M6-004 P0** 每设备保存 port、role、deadband、axis transform、rumble。
- [x] **M6-005 P0** Driver/Operator/Technician 只是默认 role，允许自定义。
- [x] **M6-006 P0** 检测 USB port 冲突。
- [x] **M6-007 P0** 允许同一 Trigger/Event 合法绑定多个 Command，仅报告 requirement 冲突。

### 8.2 绑定编辑器

- [x] **M6-020 P0** 支持 button、axis threshold 和 POV。
- [x] **M6-021 P0** 支持 onTrue/onFalse/whileTrue/toggleOnTrue。
- [x] **M6-022 P0** 支持 chord 和简单 AND/OR/NOT 条件。
- [x] **M6-023 P0** 支持 Command 参数、超时和中断行为。
- [x] **M6-024 P0** Command 选择器显示来源、参数、requirements。
- [x] **M6-025 P0** 检测重复绑定、互斥冲突和潜在 requirement 冲突。
- [x] **M6-026 P0** 生成清晰 `OperatorInterface` Java。
- [x] **M6-027 P0** 自定义 Java Trigger 以只读摘要显示并可跳转。
- [x] **M6-028 P1** 可视化显示一个按钮的完整触发序列。

### 8.3 Command 与 RobotCommands

- [x] **M6-040 P0** 发现 public Command factory methods。
- [x] **M6-041 P0** 区分 Command instance 与 Command factory，避免组合后复用。
- [x] **M6-042 P0** 支持 sequence、parallel、race、deadline、either 等常见组合。
- [x] **M6-043 P0** 跨 Subsystem 组合默认生成到 `RobotCommands`。
- [x] **M6-044 P0** RobotContainer 只完成顶层构建和 wiring。
- [x] **M6-045 P0** 生成代码显示明确依赖和 requirements。
- [x] **M6-046 P0** 对复杂 Custom Command composition 降级为源码摘要。

### 8.4 Auto 基础

- [x] **M6-060 P0** AutoManager 读取 chooser 和可用 routines。
- [x] **M6-061 P0** 识别/管理 PathPlanner named commands。
- [x] **M6-062 P0** 检查缺失路径和 named command。
- [x] **M6-063 P1** 显示 Auto routine 结构摘要和外部打开入口。
- [x] **M6-064 P1** 与 AdvantageScope/PathPlanner GUI 提供快捷打开，不重复实现其编辑器。

**M6 验收场景：** 用户可添加不同类型主/副操设备，将按钮绑定到跨 Subsystem Command；生成的 OI/RobotCommands/RobotContainer 代码清晰且通过编译。

## 9. M7：预制模块

### 9.1 Preset 基础设施

- [x] **M7-001 P0** 定义 preset manifest、schema、version、dependencies、outputs。
- [x] **M7-002 P0** 定义 Base/Preset/App 兼容范围。
- [x] **M7-003 P0** 实现 preset 向导、预览和实例化事务。
- [x] **M7-004 P0** 实例化后记录 preset 来源和版本，但输出普通 Java。
- [x] **M7-005 P0** 用户修改后标记 customized files/regions。
- [x] **M7-006 P0** 升级使用 base/old/new 三方 Diff，不静默覆盖。
- [x] **M7-007 P0** preset 可附带 validator、docs、calibration steps。
- [x] **M7-008 P0** preset fixture 必须 Real/Sim compile。

### 9.2 Swerve Preset

- [x] **M7-020 P0** 向导配置 wheelbase、trackwidth、wheel radius、max speed。
- [x] **M7-021 P0** 配置四模块位置、Drive/Steer/CANcoder ID 和 bus。
- [x] **M7-022 P0** 配置 gear ratios、inversion、offset、PID/FF/current limit。
- [x] **M7-023 P0** 配置 Pigeon/Gyro ID、bus、mount pose。
- [x] **M7-024 P0** 生成 Config、Factory、Subsystem、module definitions。
- [x] **M7-025 P0** 生成 Real/Sim 和默认 field-relative drive command。
- [x] **M7-026 P0** 接入 odometry 和 PathPlanner 基础配置。
- [x] **M7-027 P0** 生成 NT metadata 和英文 docs。
- [x] **M7-028 P0** 验证模块数量、几何、设备冲突、offset 缺失和单位。
- [x] **M7-029 P1** 添加 offset、方向和 Gyro mount 校准向导。

### 9.3 Limelight Preset

- [x] **M7-040 P0** 配置设备名、NT table、pipeline 和 stream mode。
- [x] **M7-041 P0** 配置 robot-to-camera Transform 和坐标约定。
- [x] **M7-042 P0** 生成目标/位姿读取、时间戳、延迟和有效性处理。
- [x] **M7-043 P0** 生成无目标、断线和 Sim fallback。
- [x] **M7-044 P0** 生成可选 localization/aiming 接口，不强制具体策略。
- [x] **M7-045 P0** 生成英文安装、标定和坐标文档。
- [x] **M7-046 P0** 验证 transform、设备名和 pipeline 范围。

### 9.4 后续常用预制

- [x] **M7-060 P1** 单电机 Percent Output 机制。
- [x] **M7-061 P1** Velocity Flywheel + followers。
- [x] **M7-062 P1** Position mechanism + zero/limits。
- [x] **M7-063 P1** BeamBreak conveyor/indexer。
- [x] **M7-064 P2** LED Indicator。

**M7 验收场景：** 从空 Base 添加 Swerve 和 Limelight 后，设备树、代码、Sim、依赖、NT 和 docs 一次生成并编译；用户手改后升级不会丢失修改。

## 10. M8：NetworkTables 调参与回写

### 10.1 连接管理

- [x] **M8-001 P0** 支持 team number、hostname、IPv4 和 localhost/simulator 地址。
- [x] **M8-002 P0** 实现 NT4 connect/disconnect/auto reconnect。
- [x] **M8-003 P0** 显示 connecting/connected/stale/error 和最后更新时间。
- [x] **M8-004 P0** 仅订阅项目声明 prefix，支持低带宽策略。
- [x] **M8-005 P0** 连接失败给出地址、防火墙、机器人状态建议。
- [x] **M8-006 P0** 连接信息和日志不得泄露不必要的网络数据。

### 10.2 参数声明

- [x] **M8-020 P0** 参数支持 publish、tunable、path、type、unit、tolerance。
- [x] **M8-021 P0** 自动路径 `/Tuning/<Subsystem>/<Mechanism>/<Parameter>`。
- [x] **M8-022 P0** 支持全局 root、模块 path 和单参数完整 path 覆盖。
- [x] **M8-023 P0** 生成对应 Java NT 发布/调节代码。
- [x] **M8-024 P0** 路径修改同步 YAML、Java、docs。
- [x] **M8-025 P0** 检测重复 path、不同 type 和越界值。

### 10.3 差异页面

- [x] **M8-040 P0** 表格显示参数、Code Default、Live NT、Delta、unit、path。
- [x] **M8-041 P0** 默认只显示有差异的值。
- [x] **M8-042 P0** 支持 subsystem、类型、更新时间和搜索筛选。
- [x] **M8-043 P0** 浮点使用 tolerance，数组/结构值有明确比较规则。
- [x] **M8-044 P0** stale、type mismatch、out of range 单独显示且不可回写。
- [x] **M8-045 P0** 支持逐项和批量勾选。

### 10.4 写回闭环

- [x] **M8-060 P0** “Write NT values to code” 创建一个 domain batch command。
- [x] **M8-061 P0** 更新 YAML 默认值和对应 Java Builder/constant。
- [x] **M8-062 P0** 显示完整 Diff，不直接部署。
- [x] **M8-063 P0** 写入后运行 Spotless 和 compile。
- [x] **M8-064 P0** compile 失败回滚或明确保留为未通过状态。
- [x] **M8-065 P0** compile 成功后提供独立 Deploy 按钮。
- [x] **M8-066 P0** 操作历史记录回写来源、时间和旧值。
- [x] **M8-067 P1** 支持将一组现场参数保存为命名 snapshot。

**M8 验收场景：** 在 simulator 改变 PID/FF/limit 等多个值，应用只显示真实差异；选中后 YAML 和 Java 同步更新，编译通过且无需手工复制数字。

## 11. M9：Docs、验证、构建与诊断闭环

### 11.1 唯一 AGENTS.md 与英文 docs

- [x] **M9-001 P0** 根目录只生成一个简短英文 `AGENTS.md`。
- [x] **M9-002 P0** `AGENTS.md` 指向 docs、结构边界、managed 规则和常用命令。
- [x] **M9-003 P0** 生成 `ROBOT_OVERVIEW.md`。
- [x] **M9-004 P0** 生成 `HARDWARE_MAP.md`，含设备、位置、ID、bus、用途。
- [x] **M9-005 P0** 生成 `SUBSYSTEMS.md`，含层级、依赖和源文件。
- [x] **M9-006 P0** 生成 `CONTROL_BINDINGS.md`。
- [x] **M9-007 P0** 生成 `STATE_MODEL.md`，区分 Goal/Status/Command。
- [x] **M9-008 P0** 生成 `CODE_STYLE.md` 和 `SAFETY.md`。
- [x] **M9-009 P0** 每份 docs 支持 generated/user supplement 分区。
- [x] **M9-010 P0** UI 可编辑 user supplement，不翻译自动生成技术名。
- [x] **M9-011 P0** 更新模型时保留用户内容和 Markdown 格式。
- [x] **M9-012 P0** 文档生成具有确定性并进入 Diff/事务。

### 11.2 Problems 中心

- [x] **M9-020 P0** 聚合 Schema、模型、Java parser、build、preset、NT 问题。
- [x] **M9-021 P0** severity：error、warning、info。
- [x] **M9-022 P0** 每项关联对象、文件、行列和解释。
- [x] **M9-023 P0** 点击定位树节点/Inspector/源码或外部 IDE。
- [x] **M9-024 P0** 对安全的修复提供 Quick Fix 和 Diff。
- [x] **M9-025 P0** 相同问题去重，外部修复后实时消失。
- [x] **M9-026 P1** 导出诊断报告用于 Issue。

### 11.3 Build/Format/Test/Simulate/Deploy

- [x] **M9-040 P0** Toolchain 页显示 WPILib JDK、Gradle、年份和状态。
- [x] **M9-041 P0** 实现 Spotless、compile、test、simulate、deploy 命令。
- [x] **M9-042 P0** 任务输出流式显示并可取消。
- [x] **M9-043 P0** 解析 Java/Gradle error 并可点击打开 IDE。
- [x] **M9-044 P0** 防止重复启动互斥 Gradle 任务。
- [x] **M9-045 P0** Deploy 前显示 team、目标、Git/文件未保存状态和构建结果。
- [x] **M9-046 P0** 危险/真实机器人操作需要明确确认。
- [x] **M9-047 P1** 保存最近任务输出和耗时。
- [x] **M9-048 P1** 提供“Open in AdvantageScope/PathPlanner”快捷入口。

### 11.4 Auto 与 Telemetry 完善

- [x] **M9-060 P0** Auto chooser、routine、path 和 named command 验证完整。
- [x] **M9-061 P1** 显示当前 Auto 摘要和缺失资源。
- [x] **M9-062 P0** RobotTelemetry 聚合关键状态，不把逻辑散落在 Container。
- [x] **M9-063 P1** FieldPublisher/RobotStateRecorder 文档和配置入口。

### 11.5 校准和安全诊断

- [x] **M9-080 P1** Swerve offset/direction 检查向导。
- [x] **M9-081 P1** Pigeon mount orientation 检查。
- [x] **M9-082 P1** Mechanism zero/home 和 limit 检查。
- [x] **M9-083 P1** Limelight transform 检查。
- [x] **M9-084 P1** 单设备低功率方向测试，带安全确认和自动停止。
- [x] **M9-085 P1** SysId 入口和结果文件定位。
- [x] **M9-086 P1** 校准结果通过标准事务写回项目。

**M9 验收场景：** 一个新 AI 只读根 `AGENTS.md` 和 docs 就能找到硬件、控制、状态和安全规则；用户能从问题定位到代码并完成 build/sim/deploy。

## 12. M10：质量、跨平台与 Beta 发布

### 12.1 测试矩阵

- [x] **M10-001 P0** Domain/Schema/Generator 单元覆盖关键分支。
- [x] **M10-002 P0** 至少维护空 Base、单电机、Shooter、Swerve+Limelight 四类 golden fixture。
- [x] **M10-003 P0** 无 YAML 的 10541 导入 fixture 固定识别结果。
- [x] **M10-004 P0** 所有生成 fixture 在 WPILib JDK 下 compile。
- [x] **M10-005 P0** 事务中断、磁盘写失败和恢复集成测试。
- [x] **M10-006 P0** 外部编辑冲突和不丢 Custom Java 测试。
- [x] **M10-007 P0** Electron typed IPC 权限和路径穿越测试。
- [x] **M10-008 P0** Create/Open/Edit/Diff/Build 的 Playwright E2E。
- [x] **M10-009 P0** 中英文 UI 截图和布局回归。
- [x] **M10-010 P0** Windows/macOS/Linux packaged smoke test（GitHub Actions 三平台 runner 已验证）。
- [x] **M10-011 P1** 可访问性自动扫描和人工键盘验收。

### 12.2 性能目标

- [x] **M10-020 P0** 冷启动、打开项目、首次索引和增量索引建立基准。
- [x] **M10-021 P0** 10541 规模项目打开期间 UI 不阻塞。
- [x] **M10-022 P0** 大树使用增量渲染或虚拟化，不重绘全部节点。
- [x] **M10-023 P0** Parser/generator 任务移出 Renderer 主线程。
- [x] **M10-024 P0** NT 更新批处理，避免高频刷新整个页面。
- [x] **M10-025 P1** 记录内存占用和长期运行泄漏测试。

建议 Beta 性能门槛：

- 桌面壳可交互时间小于 3 秒（目标开发机）；
- 10541 级项目首次索引小于 5 秒；
- 单文件外部修改刷新小于 500 ms；
- 普通 Inspector 编辑到 Diff 预览小于 300 ms，不含 Spotless/Gradle。

### 12.3 打包与发布

- [x] **M10-040 P0** Windows installer 和 portable/zip artifact。
- [x] **M10-041 P0** macOS DMG/zip artifact（GitHub Actions macOS runner 已验证）。
- [x] **M10-042 P0** Linux deb/rpm 和 zip artifact（GitHub Actions Linux runner 已验证）。
- [x] **M10-043 P0** 每个平台生成 SHA-256 校验值和 SBOM/许可文件。
- [x] **M10-044 P0** 版本号、release notes、Schema/Base/Preset 版本写入 About。
- [x] **M10-045 P0** 迁移前自动备份并测试降级提示。
- [!] **M10-046 P1** Windows code signing（已接入可选签名配置，缺少用户证书与密码）。
- [!] **M10-047 P1** macOS Developer ID signing/notarization（已接入配置，缺少 Apple 身份与凭据）。
- [x] **M10-048 P1** GitHub Releases 更新检查。
- [x] **M10-049 P2** 在签名与回滚成熟后评估自动更新。

### 12.4 Beta 验收

- [x] **M10-060 P0** 用真实 10541 FRC 项目完成创建、导入和持续编辑回归。
- [x] **M10-061 P0** 生成项目脱离软件后通过独立 Gradle 编译、测试与交接文档验收。
- [!] **M10-062 P0** 至少一次机器人/模拟器 NT 调参回写测试（协议与回写自动测试已通过，需真实 robot/simulator 会话）。
- [!] **M10-063 P0** 至少一次 Swerve 和 Limelight preset 实战测试（生成与真实 WPILib 编译已通过，需真实机器人验收）。
- [!] **M10-064 P0** 收集新手与有经验队员的首次使用观察，不提供教程提示（需外部队员参与）。
- [x] **M10-065 P0** 修复已发现的数据丢失、静默覆盖、路径越界和错误部署类问题。
- [x] **M10-066 P0** 发布已知限制和恢复说明。

## 13. 跨阶段持续任务

### 13.1 每年 WPILib 与厂商库适配

- [x] **CONT-001 P0** Base、Schema、Catalog、Preset 使用独立版本。
- [x] **CONT-002 P0** 为当前支持的 WPILib 2026 维护真实 Gradle 编译矩阵。
- [x] **CONT-003 P0** 未验证年份被模型与创建 UI 明确阻止，先更新 fixture 和兼容报告才能开放。
- [x] **CONT-004 P0** Phoenix/PathPlanner/AdvantageKit/IronPulse 版本显式固定，不兼容 Base/Preset 明确阻止升级。
- [x] **CONT-005 P1** About 与创建 UI 显示项目年份支持状态，已知问题独立发布。

### 13.2 数据安全

- [x] **CONT-020 P0** 任何删除/覆盖前解析并显示准确目标。
- [x] **CONT-021 P0** 所有 materially destructive 操作可恢复或有明确二次确认。
- [x] **CONT-022 P0** 事务临时备份完成后清理；Schema 迁移备份只保留最新 5 份。
- [x] **CONT-023 P0** 诊断与崩溃输出不记录 Java 源码全文或网络密钥。
- [x] **CONT-024 P0** 错误报告默认本地保存，上传需用户明确选择。

### 13.3 UX 与可访问性

- [x] **CONT-040 P0** 新功能包含 empty、loading、error、disabled 状态。
- [x] **CONT-041 P0** 主要操作通过键盘与 Playwright 验收。
- [x] **CONT-042 P0** 状态同时使用文本、图标或形状，不只依赖颜色。
- [x] **CONT-043 P0** 危险操作、真实机器人和 simulator 有明显区分与确认。
- [x] **CONT-044 P0** 高级参数默认折叠但可以搜索发现。
- [x] **CONT-045 P0** UI 隐藏内部 UUID 和无需理解的生成细节。

### 13.4 文档与决策

- [x] **CONT-060 P0** 长期兼容性决策写入 ADR。
- [x] **CONT-061 P0** 每个 milestone 完成时更新本 TODO 和总体规划偏差。
- [x] **CONT-062 P0** 用户文档与自动生成机器人 docs 分开维护。
- [x] **CONT-063 P0** 公开文件格式变更带 migration、备份和测试示例。

### 13.5 GitHub 发布前收尾

- [x] **CONT-080 P0** 预制模块移除 Renderer 中的 Node `crypto` 依赖并增加确定性 ID 测试。
- [x] **CONT-081 P0** 全部预制提供中英文简介、快速开始、输出说明和合理默认值。
- [x] **CONT-082 P0** 参数 Inspector 使用明确的 NetworkTables 控件，默认允许 NT 调试并显示参数说明。
- [x] **CONT-083 P0** Diff 应用后保持选中实体并立即刷新 Inspector。
- [x] **CONT-084 P0** Java Command、Auto 与文件增删通过增量索引实时同步到界面。
- [x] **CONT-085 P0** 应用内与安装包图标使用同一透明 SVG 资源。
- [x] **CONT-086 P0** 添加单版本输入的 Windows/macOS/Linux 自动构建与 GitHub Release workflow。
- [x] **CONT-087 P0** 移除 commit hooks，普通 Git 提交不隐式运行项目检查。
- [x] **CONT-088 P0** 允许未修改的全文件预制 Java 参与后续结构化操作，同时保留真实外部修改冲突保护。
- [x] **CONT-089 P0** Subsystem 删除支持层级、设备、Command、Binding、Auto 与生成文件的影响预览和级联清理。
- [x] **CONT-090 P0** Java 扫描覆盖层按稳定实体 ID 去重，Subsystem 删除只在后端权威模型上执行级联，避免 Swerve Mechanism 删除产生重复 Command ID。
- [x] **CONT-091 P0** 存在未处理 Diff 时阻止下一次结构化修改，并以中英文提示先应用或放弃上一次修改。
- [x] **CONT-092 P1** 扩充独立实现的 IronPulse 兼容 Base（Beam Break、Rumble、布尔工具），并在 About、README 与第三方说明中鸣谢 IronPulse 6941。
- [x] **CONT-093 P0** 文件监听器按防抖后的最终磁盘内容识别原子替换，避免 Linux 将软件自身生成写入误报为外部修改。
- [x] **CONT-094 P0** 任意深度的 Subsystem/Mechanism/Group 都生成独立 Java 文件，并只拥有直接设备、Goal 与局部命令。
- [x] **CONT-095 P0** 节点“代码”按钮使用统一 Java 位置解析器打开精确文件，设备打开其直接拥有者文件。
- [x] **CONT-096 P0** 无 `project.yaml` 时按 Java 包与目录递归恢复嵌套树，同时兼容旧式合成根目录。
- [x] **CONT-097 P0** Swerve/Limelight 全文件预制支持嵌套子节点构造注入、更新迁移和级联删除，不产生重复实体 ID。
- [x] **CONT-098 P1** IronPulse Catalog v2 按 10541 offseason commit `c0df8d8` 校准远程 CANcoder、zero offset/filter、Motion Magic 和 unit API 兼容层。
- [x] **CONT-099 P0** 增加三层嵌套、Swerve 内嵌 Goal 节点、删除、Java 回读与真实 WPILib/Phoenix 编译回归测试。
- [x] **CONT-100 P0** `RobotCommands` 按 requirement 精确注入嵌套节点，不再将 Mechanism 强制提升为顶层 Subsystem。
- [x] **CONT-101 P0** 设备 Java symbol 按直接拥有者作用域校验，自动 NT 路径加入设备名，支持不同分支同名硬件且不冲突。
- [x] **CONT-102 P0** 修复 Vite 冷启动依赖优化竞态；Electron 仅在根组件挂载后显示窗口，并增加独立冷缓存开发 smoke test。
- [x] **CONT-103 P0** 结构化预览仅合并本次模型变化实际影响的生成文件；兼容旧版合并式嵌套 Java 布局，并在真实冲突中报告具体文件路径。
- [x] **CONT-104 P0** 补齐 Goal、Auto、控制器、绑定、Command、引用和可选参数的删除闭环；安全兼容旧版 full-file preset 的模型专属嵌套节点删除；代码变更默认直接应用，并可在设置中开启确认预览。
- [x] **CONT-105 P0** 修复重复 `pnpm dev` 与中断启动造成的 Vite/Electron 缓存竞争：开发缓存按进程隔离、依赖强制重建、Electron 单实例恢复，并延长渲染器自动恢复窗口。
- [x] **CONT-106 P0** 普通预制模块支持在创建时选择任意层级父节点、同类多实例与精确级联删除；Velocity/Position Goal 通过默认 Command 实际驱动闭环目标，单位元数据、换算、参数刷新与真实 Gradle 编译均有回归验证。

## 14. 首批开发迭代建议

### Iteration 1：可以启动的安全桌面壳

- [x] 完成 M0-001 至 M0-047。
- [x] 完成 M1-001 至 M1-045。
- [x] 形成 Material 3 黑灰白工作区和中英文首页。

### Iteration 2：不会丢数据的项目内核

- [x] 完成 M2 Schema、domain command、Diff、transaction、watcher。
- [x] 建立一个简单文本 fixture 做崩溃恢复测试。

### Iteration 3：第一个真实 FRC 输出

- [x] 完成现有两个机器人仓库结构分析。
- [x] 重写空 Base。
- [x] 从空目录创建项目并用 WPILib JDK 编译。

### Iteration 4：第一个可视化电机机制

- [x] 实现逻辑树、Subsystem/Mechanism/Motor。
- [x] 支持 TalonFX 主从、常用配置、PID/FF/limit 和 Sim。
- [x] YAML、Java、硬件 docs 同步并带 Diff。

### Iteration 5：代码协作而非代码封闭

- [x] 导入无 YAML 项目。
- [x] 实现 Recognized/Custom 显示、IDE 跳转、import/reference、Goal scaffold。
- [x] 验证任意 Custom Java 不会被结构化修改覆盖。

完成这五个迭代后再扩大到 Controls、Presets 和 NT，避免在项目模型、事务和代码边界尚未稳定时同时开发过多表面功能。

## 15. Release Gate

### Alpha Gate

- [x] M0–M5 的全部 P0 完成。
- [x] 可以创建、打开、导入、编辑一个电机 Subsystem。
- [x] 无已知静默覆盖或无法恢复的数据丢失问题。
- [x] Windows packaged build 可运行。

### Preview Gate

- [x] M6–M8 的全部 P0 完成。
- [x] Swerve、Limelight、Controls 和 NT 写回通过真实 fixture。
- [x] Windows、macOS、Linux packaged smoke test 均已通过对应 CI runner。

### Beta Gate

- [ ] M9–M10 的全部 P0 完成。
- [ ] 真实机器人项目试用通过。
- [ ] 安全、迁移、恢复、跨平台和无软件交接测试通过。
- [ ] 所有 P0/P1 数据安全问题关闭；其他已知问题有清晰说明。

## 16. 2026-07 完整机器人验收与生成结构收敛

- [x] **CONT-107 P0** 更新检查固定使用 `DDguan2010/frc-framework`；仓库存在但尚无 GitHub Release 时显示正常空状态，不再把 `/releases/latest` 的 404 报为仓库错误。
- [x] **CONT-108 P0** 参考 10541 将电机节点拆分为相邻的 `<Node>Config.java` 与 `<Node>.java`：前者负责硬件/调参构造，后者负责 Goal、Default Command、局部命令与运行逻辑。
- [x] **CONT-109 P0** 所有普通生成节点继承 `SubsystemBase`，Goal Command 声明明确 requirement；Java 无 YAML 回读忽略 `*Config`/`*Constants`，避免其变成伪 Subsystem。
- [x] **CONT-110 P0** Inspector 对所有生成节点始终提供运行代码入口，对有硬件 Config 的节点提供独立“打开硬件配置”入口（中/英双语）。
- [x] **CONT-111 P0** 新增完整验收机器人：Swerve、Limelight、Intake Roller/Pivot、Shooter 双飞轮/Hood/Feeder、LED、NT、双手柄、Bindings、跨系统 Commands、PathPlanner Named Commands、Auto、Telemetry 与 Docs；真实 WPILib Gradle 格式化、编译、测试及 Java 重新索引通过。
- [x] **CONT-112 P1** 新增 `docs/GENERATED_PROJECT_ARCHITECTURE.md` 和 `pnpm test:acceptance-robot`，明确 Config/Subsystem/RobotCommands/RobotContainer 的代码放置边界并形成可重复验收闭环。
- [x] **CONT-113 P0** Swerve 与受支持的 Driver Controller 同时存在时自动生成带 deadband/scale/axis inversion 的 field-relative Default Command；Xbox、PS4、PS5、Joystick 与 Generic HID 均有明确轴映射，完整验收项目已编译验证。
- [x] **CONT-114 P0** 修复 Bash、PowerShell 与 pnpm 间的发布版本参数转发差异，增加解析回归测试，并将 GitHub Actions 升级到基于 Node 24 的当前主版本。
- [x] **CONT-115 P0** GitHub Release 只公开 Windows EXE、macOS DMG、Linux DEB/RPM 四个原生安装包；便携包、Squirrel 中间文件和审计元数据仅保留为 Actions 构建产物，并通过白名单回归测试防止发布页再次混入内部文件。
- [x] **CONT-116 P0** 源码树改为真实文件夹层级，统一识别 Java、Kotlin、C/C++、Gradle、PathPlanner、配置、脚本、文档、AdvantageScope/机械模型和机器人日志；二进制与超大文件不作为文本读取。
- [x] **CONT-117 P0** Java 回读增加继承/接口、嵌套 Goal/State enum 值、字段初始化器、真实 HID 端口与独立 Command class 推断；基础包可从非标准手写项目自适应恢复。
- [x] **CONT-118 P0** `project.yaml` 与源码覆盖层扩展到 Subsystem、Goal、Device、Controller、Binding、Command 和 Auto，按稳定 ID、源码路径、符号与父子引用重映射，并删除已经从手写代码移除的旧推断。
- [x] **CONT-119 P0** 手写 Java 推断实体在界面中明确显示只读所有权，禁止产生假同步的重命名、参数、Goal、删除、拖拽和嵌套创建，同时保留源码跳转与实时重新索引。
- [x] **CONT-120 P1** 逻辑树/源码树切换时清除跨视图筛选；新增 Mechanism、Device、Goal 和嵌套预制后自动展开完整父链并选中新实体。
- [x] **CONT-121 P0** 以 10541 完整项目、手写源码实时变更、Typed Source Inventory、冷缓存开发启动、Electron 打包 E2E 和完整验收机器人形成兼容性回归闭环。
- [x] **CONT-122 P1** 左侧导航/项目树与右侧 Inspector 改为按窗口可用空间动态拉伸，最大宽度扩展到 720/840 px，中等宽度窗口保留拖拽能力，命中区域扩大并在缩放窗口后恢复用户偏好宽度。
- [x] **CONT-123 P1** 逻辑树为 Robot、Subsystem、Group、Mechanism、各类设备、Goal 与 Command 分配互不重复的 Material 图标，消除 Motor/Command 及不同设备共用图形造成的辨识混淆。
- [x] **CONT-124 P0** 仓库采用 MIT License，根许可证、发布清单元数据与 README 许可说明保持一致。
- [x] **CONT-125 P0** Subsystem、Group 与 Mechanism 创建改为名称/父级驱动的自动 Java 位置；Inspector 与拖拽移动同步迁移 runtime、Config、package、import、构造引用、YAML 和 docs，并保留 Managed 区域外队伍代码。
- [x] **CONT-126 P0** 完整机器人验收扩展为创建、三层嵌套、手写代码、移动、重命名、Goal 增删、NT 写回/快照、删除、重开、Java 回读与再次 Gradle 编译的全生命周期闭环。
- [x] **CONT-127 P0** Subsystem 重命名同步重构跨文件 Command 中的类标识符和组合字段；Java 词法替换避开字符串、字符、注释与文本块，并支持重复类名解除后其他字段名同步变化。
- [x] **CONT-128 P0** Java 回读仅从机器人运行时基础包推断结构，排除 ext/test/generated 与基础设施访问器；旧源码导入 YAML 自动清除 Config/Constants/Calculator 假节点，生成代码和库方法不再重复计入 Command。
- [x] **CONT-129 P1** Inspector 显示名称在 Java 标识符未定制时自动联动，并以中英文说明高级覆盖规则；生产 Electron E2E 覆盖名称驱动的文件迁移。
- [x] **CONT-130 P0** 源码覆盖层只将真正的手写/显式保留文件标记为只读；全部预制模块在重开后仍保持结构可编辑，并由覆盖 Swerve、Limelight、Velocity、Position、Beam-break 与 LED 的完整机器人验收防止回归。
- [x] **CONT-131 P1** Auto 工作区始终提供“打开代码”：生成 Auto 跳转到关联的 RobotCommands 工厂，手写 Auto 跳转到实际 Java 文件，无关联 Command 时回退 AutoRoutines；PathPlanner 资源保留独立入口。
- [x] **CONT-132 P1** 左侧逻辑树与 Command 工作区为全部手写/生成 Command 提供统一代码入口，并利用实时 Java 符号索引将编辑器直接定位到对应方法的行列；Auto 关联 Command 复用同一定位结果。
- [x] **CONT-133 P0** Java 回读将 Subsystem 类内的 Command 工厂及其子目录独立 Command 类自动关联到所属 Subsystem；真实跨系统/项目级 Command 保留在 Robot 根部，10541 与合成手写项目均有归属回归测试。
- [x] **CONT-134 P0** 混合手写/生成项目中的预制添加、Controller 删除和 Command 级联删除改用增量 Domain 事务，不再把只读源码覆盖层整批回写为受管结构；Electron E2E 覆盖手写 Subsystem 与新增预制并存。
- [x] **CONT-135 P1** Electron 使用可缩放的无边框窗口，将拖拽区域与最小化、最大化/还原、关闭操作合并进 Material 3 应用顶栏；窗口状态通过受限 IPC 实时同步并纳入跨平台 E2E 回归。
