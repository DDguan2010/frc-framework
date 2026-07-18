# FRC Framework 使用指南

FRC Framework 用可视化结构维护 `project.yaml`，并把确认后的修改生成到清晰、可独立编译的 WPILib Java 项目。软件不是机器人运行时依赖；离开本软件后，生成项目仍可直接交给队友、VS Code、WPILib 和 Gradle 使用。

## 1. 安装与启动

Windows 用户可运行 `FRC Framework-0.1.0 Setup.exe` 安装，也可解压 ZIP 后直接运行 `frc-framework.exe`。开发模式需要 Node.js 24 与 pnpm 10：

```bash
pnpm install
pnpm dev
```

启动窗口会使用当前显示器的完整可用工作区。界面语言首次跟随系统，可在左侧底部“设置 / Settings”中切换中文或英文。

## 2. 创建和打开项目

### 创建

1. 首页点击“选择文件夹”。
2. 选择一个空文件夹。
3. 填写项目名、队号、Java 包名；当前版本支持 WPILib 2026。
4. 点击“创建”。软件先生成预览并执行安全写入，随后使用 WPILib JDK 验证项目。

### 打开或导入

- 含 `project.yaml`：优先读取结构化模型，再索引 Java 文件。
- 没有 `project.yaml` 的 WPILib 项目：解析源码并显示 Recognized、Partial、Custom 导入预览；确认后才创建结构化模型。
- 也可从“最近项目”、命令行路径、文件关联或拖入目录打开。

任何结构化修改都会先进入底部“Diff”区域。检查新增、修改、删除和冲突后点击“应用”；关闭或拒绝预览不会写入项目。

## 3. 项目结构与代码

左侧树可切换两种视图：

- “逻辑”：Robot → Subsystem/Mechanism → Device 的结构；
- “源码”：Recognized、Partial、Custom 文件及外部修改状态。

在“项目”页可添加 Subsystem、Mechanism、Device 和 Goal。选择节点后，在右侧 Inspector 修改名称、Java symbol、CAN ID、总线、参数、仿真和 NT 发布选项。

这里的 **Mechanism（机构）** 不是另一个必须参与 WPILib 调度的 Subsystem，而是 Subsystem 内部的物理功能单元。例如 `Shooter` 是一个 Subsystem，其中可包含 `Upper` 和 `Lower` 两个 Mechanism；每个 Mechanism 再包含自己的电机、传感器、参数和目标值。它让结构和真实机器人一致，又不会强迫每组电机都拆成 Java Subsystem。

“打开代码”会按设置的编辑器准确跳转到 Java 文件与行列。代码协作支持：

- 添加另一个 Java 类型的 import；
- 添加跨 Subsystem 引用与构造注入；
- 为 Subsystem 生成 Goal 状态枚举和 `setGoalCommand`；
- 保留 Custom Java 与非托管代码，不把解析失败的逻辑强行改写。

软件持续监听项目中的 Java 文件，并以 80 ms 文件事件防抖和 120 ms 界面批处理增量更新源码索引。新增或删除的 Command、Auto 例程和自定义 Java 文件会自动出现在界面中，不必重新打开项目；这些从源码识别的项目以只读叠加方式显示，不会污染 `project.yaml`。如果外部编辑器修改了受管理文件，软件会要求选择重新载入、比较、保留外部版本或重新生成，不会静默覆盖。

## 4. 电机、参数与预制模块

添加 Device 时可从 IronPulse Catalog 选择 TalonFX 主电机、Follower、CANcoder、Spark、PWM、DIO 等组件。只勾选当前需要的参数；常用参数先显示，高级参数可展开并搜索。

常见配置包括 CAN ID/总线、反相、限位、PID、Feedforward、Motion Magic、软限位、编码器比率、归零、仿真范围和摩擦电压。每个参数都显示用途说明和单位；说明来自 IronPulse/WPILib 的配置语义，并针对常用参数补充了调试提示。新建 Device 的参数默认都可通过 NetworkTables 调试，之后可在 Inspector 中用明确的“NetworkTables / NT”开关逐项关闭。参数还可分别设置：

- 是否发布到 NetworkTables；
- 是否允许实时写入；
- 自动生成的 NT 路径，或手工覆盖路径。

“预制”页可直接创建完整模块：Swerve、Limelight、单电机 Percent Output、Flywheel、Position Mechanism、Beam-break Indexer 和 LED Indicator。每张预制卡片都有中英文简介，选中后还会显示快速开始步骤、将生成的结构和推荐默认值。Swerve 会生成模块几何、驱动/转向/编码器、里程计、真实 IO 和仿真入口；Limelight 会生成相机、姿态变换与可选融合逻辑。所有预制先显示 Diff，再由用户确认写入；后续升级仍经过 Diff 与三方合并。

## 5. Command、控制器与 Auto

“Commands”页定义可复用 Command，可选择所属 Subsystem、跨系统依赖和实现入口。

“Controls”页：

1. 添加控制器提供者，例如 Xbox、Joystick 或自定义 HID；
2. 设置端口和 driver/operator 角色；
3. 添加 binding，选择输入表达式、触发行为和目标 Command。

简单按钮、POV、组合触发和轴阈值可结构化编辑。源码中出现更复杂的压力/连续逻辑时，界面保留其代码引用并提示到代码中维护。

“Auto”页用于组合自动例程、Named Command、起始姿态和参数，并生成独立的 auto 包。跨 Subsystem 行为放在命令层，`RobotContainer` 只负责构造与连接。

## 6. NetworkTables 调参

1. 在“NT 调参”填写机器人或 simulator 地址并连接。
2. 软件按项目模型订阅已发布参数，显示代码默认值、实时值和差值。
3. 可搜索或只显示发生变化的项目。
4. 勾选需要固化的值，点击“将选中的 NT 值写入代码”。
5. 检查 Diff 后应用；软件会更新 `project.yaml`、Java 和调参历史，并运行验证。

软件不会替代 AdvantageScope 的通用图表功能；它负责“哪些值改变了”和“把选定值安全部署回代码”。

## 7. 校准、诊断与工具链

“Calibration”页提供编码器方向、Swerve 映射、Limelight transform、单设备低功率方向测试和 SysId 入口。会动真实硬件的操作必须明确确认，并带低功率与自动停止保护。

“Problems”页汇总 Schema、CAN 冲突、引用、源码解析、工具链和部署问题；可点击定位到结构节点或 Java 行，部分问题提供 Quick Fix。

“Toolchain”页可执行：

- Spotless：格式化 Java；
- Compile：编译；
- Test：测试；
- Simulate：启动/检查仿真；
- Deploy：部署到机器人。

部署会明确显示队号、目标、真实机器人警告和最近一次构建状态，必须二次确认。软件优先使用对应年份的 WPILib JDK，不兼容的系统 Java 只作为诊断显示。

## 8. 文档、AI 与交接

每次生成会维护一个根 `AGENTS.md`，引导 AI 读取 `docs/`、`project.yaml` 和代码边界。自动生成的英文机器人文档包括架构、硬件、控制、调参和安全信息；“Docs”页允许在单独的补充区加入人工说明。

交接给没有 FRC Framework 的队友时，直接交付整个机器人项目即可。对方可以照常运行：

```bash
./gradlew spotlessApply compileJava test
```

Windows 使用 `gradlew.bat`。`project.yaml`、`AGENTS.md` 和 `docs/` 能帮助人和 AI 快速理解项目，但机器人代码不依赖桌面软件。

## 9. 编辑器设置

在“设置”中选择 WPILib VS Code、VS Code、IntelliJ IDEA、Cursor，或填写自定义程序路径。自定义参数一行一个，可使用：

- `{file}`：文件绝对路径；
- `{line}`、`{column}`：定位行列；
- `{project}`：项目根目录。

点击“测试打开”验证配置。还可为单个项目覆盖全局编辑器。

项目编辑器覆盖只保存在 FRC Framework 的本机设置中，不会写入机器人项目的 `project.yaml`，也不会产生代码 Diff。这样同一个项目在不同电脑上可以使用不同 IDE，而不污染 Git 记录。

在同一设置页的“外部应用”区域，可以分别配置 AdvantageScope 和 PathPlanner：

- “自动检测”会查找 WPILib、常用安装目录和用户应用目录；Windows 上还会检测 Microsoft Store 安装的 FRC PathPlanner；
- “自定义路径”允许直接输入路径，或点击“浏览”选择 `.exe`、macOS `.app` 或 Linux 可执行文件；
- 保存后，“Auto”和“工具链”页面的打开按钮都会使用这里的配置；找不到应用时，错误信息会提示返回设置选择自定义路径。

## 10. 恢复与发布产物

- 所有结构化写入使用事务、备份和恢复记录；异常退出后重新打开项目会执行恢复检查。
- Schema 迁移先创建时间戳备份，只保留最近 5 份。
- 删除设备前会显示准确影响；外部冲突必须人工选择处理方式。
- 诊断报告默认只保存到用户选择的本地路径，不自动上传。

发布产物位于 `apps/desktop/out/make`，校验值、SPDX SBOM 和许可清单位于 `output/release/<platform-arch>`。详细恢复和已知限制见 [RECOVERY.md](./RECOVERY.md) 与 [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)。
