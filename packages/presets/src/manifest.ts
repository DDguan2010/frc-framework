import type { ParameterType, ParameterValue } from '@frc-framework/domain';

export const PRESET_API_VERSION = 1 as const;

export interface PresetParameterSchema {
  readonly key: string;
  readonly displayName: string;
  readonly type: ParameterType;
  readonly defaultValue: ParameterValue;
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly required: boolean;
}

export interface PresetManifest {
  readonly id: string;
  readonly displayName: string;
  readonly version: number;
  readonly apiVersion: typeof PRESET_API_VERSION;
  readonly wpilibYears: readonly number[];
  readonly dependencies: readonly string[];
  readonly outputs: readonly string[];
  readonly parameters: readonly PresetParameterSchema[];
  readonly documentation: string;
  readonly calibrationSteps: readonly string[];
  readonly summary: PresetLocalizedText;
  readonly quickStart: PresetLocalizedText;
}

export interface PresetLocalizedText {
  readonly en: string;
  readonly zhCN: string;
}

export const PRESET_MANIFESTS: readonly PresetManifest[] = [
  {
    apiVersion: PRESET_API_VERSION,
    calibrationSteps: [
      'Raise the robot safely and verify every module drive and steer direction at low output.',
      'Record absolute encoder offsets with wheels facing forward.',
      'Verify Pigeon mounting orientation before enabling field-relative drive.',
    ],
    dependencies: ['WPILib', 'Phoenix 6', 'AdvantageKit'],
    displayName: 'Swerve Drive',
    summary: {
      en: 'A complete four-module swerve drivetrain with TalonFX drive/steer motors, CANcoders, Pigeon2, odometry, simulation, and PathPlanner hooks.',
      zhCN: '完整的四模块 Swerve 底盘，包含 TalonFX 驱动/转向、CANcoder、Pigeon2、里程计、仿真和 PathPlanner 接口。',
    },
    quickStart: {
      en: 'Enter the measured geometry, gear ratios, and 13 unique CAN IDs. Defaults are safe starting structure values; encoder offsets and gains must be calibrated on the robot.',
      zhCN: '填写实测几何尺寸、减速比和 13 个不重复 CAN ID。默认值可直接生成完整结构，但编码器偏移与增益仍需在机器人上标定。',
    },
    documentation: 'docs/SWERVE.md',
    id: 'frc.swerve',
    outputs: [
      'subsystems/swerve/SwerveConfig.java',
      'subsystems/swerve/SwerveSubsystem.java',
      'subsystems/swerve/SwerveModuleIO.java',
      'subsystems/swerve/SwerveModuleIOTalonFX.java',
      'subsystems/swerve/SwerveModuleIOSim.java',
      'subsystems/swerve/GyroIO.java',
      'subsystems/swerve/GyroIOPigeon2.java',
      'subsystems/swerve/GyroIOSim.java',
    ],
    parameters: [
      parameter('wheelbase', 'Wheelbase', 0.55, 'm', 0.1, 2),
      parameter('trackwidth', 'Trackwidth', 0.55, 'm', 0.1, 2),
      parameter('wheelRadius', 'Wheel radius', 0.0508, 'm', 0.01, 0.25),
      parameter('maxSpeed', 'Maximum speed', 4.5, 'm/s', 0.1, 10),
      parameter('driveRatio', 'Drive ratio', 6.75, undefined, 0.1, 50),
      parameter('steerRatio', 'Steer ratio', 21.428, undefined, 0.1, 100),
      parameter('driveKP', 'Drive kP', 0, undefined, 0, 1000),
      parameter('driveKV', 'Drive kV', 0, undefined, 0, 1000),
      parameter('steerKP', 'Steer kP', 0, undefined, 0, 1000),
      parameter('steerKD', 'Steer kD', 0, undefined, 0, 1000),
      parameter('pathTranslationKP', 'Path translation kP', 5, undefined, 0, 1000),
      parameter('pathRotationKP', 'Path rotation kP', 5, undefined, 0, 1000),
      parameter('statorCurrentLimit', 'Stator current limit', 80, 'A', 0, 800),
      parameter('supplyCurrentLimit', 'Supply current limit', 40, 'A', 0, 800),
    ],
    version: 1,
    wpilibYears: [2026],
  },
  {
    apiVersion: PRESET_API_VERSION,
    calibrationSteps: [
      'Measure the robot-to-camera transform from the robot coordinate origin.',
      'Confirm the Limelight name and pipeline in its web interface.',
      'Validate blue-origin field poses before feeding them into localization.',
    ],
    dependencies: ['WPILib NetworkTables', 'AdvantageKit'],
    displayName: 'Limelight Vision',
    summary: {
      en: 'A Limelight camera subsystem with typed target data, robot-to-camera transform, pose validity checks, simulation fallback, and localization/aiming entry points.',
      zhCN: 'Limelight 相机子系统，包含目标数据、机器人到相机变换、位姿有效性检查、仿真回退以及定位/瞄准接口。',
    },
    quickStart: {
      en: 'Match the NT table name to the camera web UI, choose a pipeline, then measure the six-value robot-to-camera transform before using pose estimates.',
      zhCN: '让 NT Table 名称与相机网页设置一致，选择 Pipeline，并在使用位姿估计前测量六项机器人到相机变换。',
    },
    documentation: 'docs/LIMELIGHT.md',
    id: 'frc.limelight',
    outputs: [
      'subsystems/vision/LimelightIO.java',
      'subsystems/vision/LimelightIONetworkTables.java',
      'subsystems/vision/LimelightIOSim.java',
      'subsystems/vision/LimelightSubsystem.java',
    ],
    parameters: [
      {
        defaultValue: 'limelight',
        displayName: 'Device name',
        key: 'name',
        required: true,
        type: 'string',
      },
      {
        defaultValue: 0,
        displayName: 'Stream mode',
        key: 'streamMode',
        maximum: 2,
        minimum: 0,
        required: true,
        type: 'number',
      },
      {
        defaultValue: 'limelight',
        displayName: 'NT table',
        key: 'table',
        required: true,
        type: 'string',
      },
      {
        defaultValue: 0,
        displayName: 'Pipeline',
        key: 'pipeline',
        maximum: 9,
        minimum: 0,
        required: true,
        type: 'number',
      },
      {
        defaultValue: [0, 0, 0, 0, 0, 0],
        displayName: 'Robot-to-camera transform',
        key: 'transform',
        required: true,
        type: 'number[]',
        unit: 'm,deg',
      },
    ],
    version: 1,
    wpilibYears: [2026],
  },
  ...commonPresetManifests(),
];

function commonPresetManifests(): readonly PresetManifest[] {
  const definitions = commonPresetDefinitions();
  return definitions.map(([id, displayName, documentation]) => ({
    apiVersion: PRESET_API_VERSION,
    calibrationSteps: [
      'Confirm wiring and channel/CAN IDs with the robot disabled.',
      'Run the generated low-power direction or sensor check.',
      'Record the verified configuration and safe operating limits in the generated document.',
    ],
    dependencies: ['WPILib', ...(id === 'frc.led-indicator' ? [] : ['Phoenix 6'])],
    displayName,
    summary: commonPresetCopy(id).summary,
    quickStart: commonPresetCopy(id).quickStart,
    documentation,
    id,
    outputs: ['project.yaml', documentation],
    parameters: [
      {
        defaultValue: displayName,
        displayName: 'Name',
        key: 'name',
        required: true,
        type: 'string',
      },
      parameter('channel', 'Primary CAN/PWM/DIO channel', 0, undefined, 0, 62),
    ],
    version: 1,
    wpilibYears: [2026],
  }));
}

function commonPresetCopy(id: ReturnType<typeof commonPresetDefinitions>[number][0]): {
  readonly summary: PresetLocalizedText;
  readonly quickStart: PresetLocalizedText;
} {
  const copy = {
    'frc.percent-output': {
      summary: {
        en: 'A minimal TalonFX mechanism for intakes, rollers, or pumps controlled by percent output.',
        zhCN: '用于 Intake、滚轮或泵的最简 TalonFX 机构，以百分比输出直接控制。',
      },
      quickStart: {
        en: 'Name the mechanism and set its CAN ID. The generated direct-control API is immediately ready for a Command binding.',
        zhCN: '设置机构名称和 CAN ID，生成的直接控制接口可以立即绑定到 Command。',
      },
    },
    'frc.velocity-flywheel': {
      summary: {
        en: 'A closed-loop velocity flywheel with optional follower motors, named speed setpoints, PID/feedforward configuration, and simulation.',
        zhCN: '闭环速度飞轮，支持从电机、命名转速、PID/前馈配置和仿真。',
      },
      quickStart: {
        en: 'Set the leader/follower CAN IDs and name speed targets such as IDLE=0 and SPEAKER=85. Tune kP and kV through NT before competition.',
        zhCN: '设置主从电机 CAN ID，并填写 IDLE=0、SPEAKER=85 等转速目标；比赛前通过 NT 调好 kP 和 kV。',
      },
    },
    'frc.position-mechanism': {
      summary: {
        en: 'A position-controlled arm, elevator, hood, or pivot with named setpoints, soft limits, zeroing parameters, and simulation.',
        zhCN: '适用于机械臂、升降、电调 Hood 或 Pivot 的位置闭环，包含命名位置、软限位、归零参数和仿真。',
      },
      quickStart: {
        en: 'Set the CAN ID, position unit, and named targets. Verify sensor direction and physical limits at low power before enabling automatic motion.',
        zhCN: '设置 CAN ID、位置单位和命名目标；自动运动前必须低功率确认传感器方向与机械限位。',
      },
    },
    'frc.beambreak-indexer': {
      summary: {
        en: 'A conveyor/indexer motor paired with a beam-break sensor and goal-driven piece handling states.',
        zhCN: '输送/Indexer 电机与光电传感器组合，并生成 Goal 驱动的物体处理状态。',
      },
      quickStart: {
        en: 'Set the motor CAN ID and DIO sensor channel, then verify sensor inversion with a game piece before binding intake commands.',
        zhCN: '设置电机 CAN ID 和 DIO 传感器通道，先用比赛物体确认传感器反相，再绑定 Intake Command。',
      },
    },
    'frc.led-indicator': {
      summary: {
        en: 'An addressable LED status indicator with simulation and a simple robot-state presentation API.',
        zhCN: '带仿真的可寻址 LED 状态指示器，提供简洁的机器人状态显示接口。',
      },
      quickStart: {
        en: 'Choose the PWM channel, then edit the generated length and state colors for your installed LED strip.',
        zhCN: '选择 PWM 通道，然后按实际灯带修改生成的 LED 数量和各状态颜色。',
      },
    },
  } as const;
  return copy[id];
}

function commonPresetDefinitions() {
  return [
    ['frc.percent-output', 'Single Motor Percent Output', 'docs/PERCENT_OUTPUT.md'],
    ['frc.velocity-flywheel', 'Velocity Flywheel + Followers', 'docs/VELOCITY_FLYWHEEL.md'],
    ['frc.position-mechanism', 'Position Mechanism + Zero/Limits', 'docs/POSITION_MECHANISM.md'],
    ['frc.beambreak-indexer', 'BeamBreak Conveyor / Indexer', 'docs/BEAMBREAK_INDEXER.md'],
    ['frc.led-indicator', 'LED Indicator', 'docs/LED_INDICATOR.md'],
  ] as const;
}

function parameter(
  key: string,
  displayName: string,
  defaultValue: number,
  unit: string | undefined,
  minimum: number,
  maximum: number,
): PresetParameterSchema {
  return {
    defaultValue,
    displayName,
    key,
    maximum,
    minimum,
    required: true,
    type: 'number',
    ...(unit === undefined ? {} : { unit }),
  };
}
