import type { FrcProjectModel, ParameterValue, PresetInstance } from '@frc-framework/domain';

export type PresetGeneratedFiles = ReadonlyMap<string, string>;

export function generatePresetFiles(model: FrcProjectModel): PresetGeneratedFiles {
  const files = new Map<string, string>();
  const packagePath = model.project.javaPackage.replace(/\./gu, '/');
  for (const preset of [...model.presets].sort((left, right) =>
    left.presetId.localeCompare(right.presetId),
  )) {
    if (preset.presetId === 'frc.swerve') {
      for (const [relative, content] of generateSwerve(model.project.javaPackage, preset)) {
        files.set(`src/main/java/${packagePath}/subsystems/swerve/${relative}`, content);
      }
      files.set('docs/SWERVE.md', swerveDocument(preset));
    } else if (preset.presetId === 'frc.limelight') {
      for (const [relative, content] of generateLimelight(model.project.javaPackage, preset)) {
        files.set(`src/main/java/${packagePath}/subsystems/vision/${relative}`, content);
      }
      files.set('docs/LIMELIGHT.md', limelightDocument(preset));
    } else if (preset.presetId.startsWith('frc.')) {
      files.set(commonPresetDocumentPath(preset.presetId), commonPresetDocument(preset));
    }
  }
  return new Map([...files.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function commonPresetDocumentPath(presetId: string): string {
  return `docs/${presetId.slice(4).replaceAll('-', '_').toUpperCase()}.md`;
}

function commonPresetDocument(preset: PresetInstance): string {
  return `# ${preset.displayName}

Generated from the \`${preset.presetId}\` common mechanism preset. The runtime implementation remains ordinary WPILib/IronPulse Java.

## Configuration

${Object.entries(preset.parameters)
  .map(
    ([key, configured]) =>
      `- ${key}: \`${Array.isArray(configured) ? configured.join(', ') : String(configured)}\``,
  )
  .join('\n')}

## Bring-up

1. Confirm wiring and IDs with the robot disabled.
2. Use a low-power direction/sensor check and stop immediately on unexpected motion.
3. Verify limits, zeroing, and setpoint units before enabling closed-loop control.

<!-- frc-framework:user-supplement:start -->
<!-- Record mechanism-specific safety, calibration, and tested values here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function generateSwerve(rootPackage: string, preset: PresetInstance): ReadonlyMap<string, string> {
  const packageName = `${rootPackage}.subsystems.swerve`;
  const wheelbase = numberValue(preset, 'wheelbase');
  const trackwidth = numberValue(preset, 'trackwidth');
  const wheelRadius = numberValue(preset, 'wheelRadius');
  const maxSpeed = numberValue(preset, 'maxSpeed');
  const driveRatio = numberValue(preset, 'driveRatio');
  const steerRatio = numberValue(preset, 'steerRatio');
  const canBus = stringValue(preset, 'canBus');
  const gyroId = numberValue(preset, 'gyroId');
  const driveIds = numberArray(preset, 'driveIds', 4);
  const steerIds = numberArray(preset, 'steerIds', 4);
  const encoderIds = numberArray(preset, 'encoderIds', 4);
  const offsets = numberArray(preset, 'encoderOffsets', 4);
  const driveInverted = booleanValueOr(preset, 'driveInverted', false);
  const steerInverted = booleanValueOr(preset, 'steerInverted', false);
  const driveKP = numberValueOr(preset, 'driveKP', 0);
  const driveKV = numberValueOr(preset, 'driveKV', 0);
  const steerKP = numberValueOr(preset, 'steerKP', 0);
  const steerKD = numberValueOr(preset, 'steerKD', 0);
  const statorCurrent = numberValueOr(preset, 'statorCurrentLimit', 80);
  const supplyCurrent = numberValueOr(preset, 'supplyCurrentLimit', 40);
  const gyroMount = numberArrayOr(preset, 'gyroMount', 3, [0, 0, 0]);
  const pathTranslationKP = numberValueOr(preset, 'pathTranslationKP', 5);
  const pathRotationKP = numberValueOr(preset, 'pathRotationKP', 5);
  const files = new Map<string, string>();
  files.set(
    'SwerveConfig.java',
    `package ${packageName};

import edu.wpi.first.math.geometry.Translation2d;

/** Generated geometry and hardware constants for the swerve preset. */
public final class SwerveConfig {
    public static final double WHEELBASE_METERS = ${javaNumber(wheelbase)};
    public static final double TRACKWIDTH_METERS = ${javaNumber(trackwidth)};
    public static final double WHEEL_RADIUS_METERS = ${javaNumber(wheelRadius)};
    public static final double MAX_SPEED_METERS_PER_SECOND = ${javaNumber(maxSpeed)};
    public static final double DRIVE_RATIO = ${javaNumber(driveRatio)};
    public static final double STEER_RATIO = ${javaNumber(steerRatio)};
    public static final boolean DRIVE_INVERTED = ${String(driveInverted)};
    public static final boolean STEER_INVERTED = ${String(steerInverted)};
    public static final double DRIVE_KP = ${javaNumber(driveKP)};
    public static final double DRIVE_KV = ${javaNumber(driveKV)};
    public static final double STEER_KP = ${javaNumber(steerKP)};
    public static final double STEER_KD = ${javaNumber(steerKD)};
    public static final double PATH_TRANSLATION_KP = ${javaNumber(pathTranslationKP)};
    public static final double PATH_ROTATION_KP = ${javaNumber(pathRotationKP)};
    public static final double STATOR_CURRENT_LIMIT_AMPS = ${javaNumber(statorCurrent)};
    public static final double SUPPLY_CURRENT_LIMIT_AMPS = ${javaNumber(supplyCurrent)};
    public static final double GYRO_MOUNT_ROLL_DEGREES = ${javaNumber(gyroMount[0] ?? 0)};
    public static final double GYRO_MOUNT_PITCH_DEGREES = ${javaNumber(gyroMount[1] ?? 0)};
    public static final double GYRO_MOUNT_YAW_DEGREES = ${javaNumber(gyroMount[2] ?? 0)};
    public static final String CAN_BUS = "${escapeJava(canBus)}";
    public static final int GYRO_ID = ${String(gyroId)};
    public static final int[] DRIVE_IDS = {${driveIds.join(', ')}};
    public static final int[] STEER_IDS = {${steerIds.join(', ')}};
    public static final int[] ENCODER_IDS = {${encoderIds.join(', ')}};
    public static final double[] ENCODER_OFFSETS_ROTATIONS = {${offsets.map(javaNumber).join(', ')}};
    public static final Translation2d[] MODULE_LOCATIONS = {
        new Translation2d(WHEELBASE_METERS / 2.0, TRACKWIDTH_METERS / 2.0),
        new Translation2d(WHEELBASE_METERS / 2.0, -TRACKWIDTH_METERS / 2.0),
        new Translation2d(-WHEELBASE_METERS / 2.0, TRACKWIDTH_METERS / 2.0),
        new Translation2d(-WHEELBASE_METERS / 2.0, -TRACKWIDTH_METERS / 2.0)
    };

    private SwerveConfig() {}
}
`,
  );
  files.set(
    'SwerveModuleIO.java',
    `package ${packageName};

import edu.wpi.first.math.kinematics.SwerveModulePosition;
import edu.wpi.first.math.kinematics.SwerveModuleState;

/** Hardware boundary for one swerve module. */
public interface SwerveModuleIO {
    final class Inputs {
        public double drivePositionMeters;
        public double driveVelocityMetersPerSecond;
        public double steerAngleRadians;
        public boolean connected = true;

        public SwerveModulePosition position() {
            return new SwerveModulePosition(
                    drivePositionMeters,
                    edu.wpi.first.math.geometry.Rotation2d.fromRadians(steerAngleRadians));
        }
    }

    default void updateInputs(Inputs inputs) {}

    default void setDesiredState(SwerveModuleState state) {}

    default void stop() {
        setDesiredState(new SwerveModuleState());
    }
}
`,
  );
  files.set(
    'SwerveModuleIOTalonFX.java',
    `package ${packageName};

import com.ctre.phoenix6.configs.CANcoderConfiguration;
import com.ctre.phoenix6.configs.TalonFXConfiguration;
import com.ctre.phoenix6.controls.PositionVoltage;
import com.ctre.phoenix6.controls.VelocityVoltage;
import com.ctre.phoenix6.hardware.CANcoder;
import com.ctre.phoenix6.hardware.TalonFX;
import com.ctre.phoenix6.signals.InvertedValue;
import edu.wpi.first.math.MathUtil;
import edu.wpi.first.math.kinematics.SwerveModuleState;

/** Phoenix 6 implementation generated by the swerve preset. */
public final class SwerveModuleIOTalonFX implements SwerveModuleIO {
    private final TalonFX drive;
    private final TalonFX steer;
    private final CANcoder encoder;
    private final VelocityVoltage driveRequest = new VelocityVoltage(0.0);
    private final PositionVoltage steerRequest = new PositionVoltage(0.0);

    public SwerveModuleIOTalonFX(int index) {
        drive = new TalonFX(SwerveConfig.DRIVE_IDS[index], SwerveConfig.CAN_BUS);
        steer = new TalonFX(SwerveConfig.STEER_IDS[index], SwerveConfig.CAN_BUS);
        encoder = new CANcoder(SwerveConfig.ENCODER_IDS[index], SwerveConfig.CAN_BUS);

        TalonFXConfiguration driveConfig = new TalonFXConfiguration();
        driveConfig.Feedback.SensorToMechanismRatio = SwerveConfig.DRIVE_RATIO;
        driveConfig.MotorOutput.Inverted = SwerveConfig.DRIVE_INVERTED ? InvertedValue.Clockwise_Positive : InvertedValue.CounterClockwise_Positive;
        driveConfig.CurrentLimits.StatorCurrentLimitEnable = true;
        driveConfig.CurrentLimits.StatorCurrentLimit = SwerveConfig.STATOR_CURRENT_LIMIT_AMPS;
        driveConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
        driveConfig.CurrentLimits.SupplyCurrentLimit = SwerveConfig.SUPPLY_CURRENT_LIMIT_AMPS;
        driveConfig.Slot0.kP = SwerveConfig.DRIVE_KP;
        driveConfig.Slot0.kV = SwerveConfig.DRIVE_KV;
        drive.getConfigurator().apply(driveConfig);
        TalonFXConfiguration steerConfig = new TalonFXConfiguration();
        steerConfig.Feedback.SensorToMechanismRatio = SwerveConfig.STEER_RATIO;
        steerConfig.MotorOutput.Inverted = SwerveConfig.STEER_INVERTED ? InvertedValue.Clockwise_Positive : InvertedValue.CounterClockwise_Positive;
        steerConfig.CurrentLimits.StatorCurrentLimitEnable = true;
        steerConfig.CurrentLimits.StatorCurrentLimit = SwerveConfig.STATOR_CURRENT_LIMIT_AMPS;
        steerConfig.CurrentLimits.SupplyCurrentLimitEnable = true;
        steerConfig.CurrentLimits.SupplyCurrentLimit = SwerveConfig.SUPPLY_CURRENT_LIMIT_AMPS;
        steerConfig.Slot0.kP = SwerveConfig.STEER_KP;
        steerConfig.Slot0.kD = SwerveConfig.STEER_KD;
        steerConfig.ClosedLoopGeneral.ContinuousWrap = true;
        steer.getConfigurator().apply(steerConfig);
        CANcoderConfiguration encoderConfig = new CANcoderConfiguration();
        encoderConfig.MagnetSensor.MagnetOffset = SwerveConfig.ENCODER_OFFSETS_ROTATIONS[index];
        encoder.getConfigurator().apply(encoderConfig);
        steer.setPosition(encoder.getAbsolutePosition().getValueAsDouble());
    }

    @Override
    public void updateInputs(Inputs inputs) {
        inputs.drivePositionMeters = drive.getPosition().getValueAsDouble() * 2.0 * Math.PI * SwerveConfig.WHEEL_RADIUS_METERS;
        inputs.driveVelocityMetersPerSecond = drive.getVelocity().getValueAsDouble() * 2.0 * Math.PI * SwerveConfig.WHEEL_RADIUS_METERS;
        inputs.steerAngleRadians = steer.getPosition().getValueAsDouble() * 2.0 * Math.PI;
        inputs.connected = drive.isConnected() && steer.isConnected() && encoder.isConnected();
    }

    @Override
    public void setDesiredState(SwerveModuleState requested) {
        double currentRadians = steer.getPosition().getValueAsDouble() * 2.0 * Math.PI;
        SwerveModuleState optimized = new SwerveModuleState(requested.speedMetersPerSecond, requested.angle);
        optimized.optimize(edu.wpi.first.math.geometry.Rotation2d.fromRadians(currentRadians));
        double wheelRotationsPerSecond = optimized.speedMetersPerSecond / (2.0 * Math.PI * SwerveConfig.WHEEL_RADIUS_METERS);
        drive.setControl(driveRequest.withVelocity(wheelRotationsPerSecond));
        steer.setControl(steerRequest.withPosition(MathUtil.angleModulus(optimized.angle.getRadians()) / (2.0 * Math.PI)));
    }
}
`,
  );
  files.set(
    'SwerveModuleIOSim.java',
    `package ${packageName};

import edu.wpi.first.math.MathUtil;
import edu.wpi.first.math.kinematics.SwerveModuleState;
import edu.wpi.first.wpilibj.Timer;

/** Deterministic lightweight simulation for desktop testing. */
public final class SwerveModuleIOSim implements SwerveModuleIO {
    private double positionMeters;
    private double velocityMetersPerSecond;
    private double steerRadians;
    private double lastTimestamp = Timer.getFPGATimestamp();

    @Override
    public void updateInputs(Inputs inputs) {
        double now = Timer.getFPGATimestamp();
        positionMeters += velocityMetersPerSecond * Math.max(0.0, now - lastTimestamp);
        lastTimestamp = now;
        inputs.drivePositionMeters = positionMeters;
        inputs.driveVelocityMetersPerSecond = velocityMetersPerSecond;
        inputs.steerAngleRadians = steerRadians;
        inputs.connected = true;
    }

    @Override
    public void setDesiredState(SwerveModuleState state) {
        velocityMetersPerSecond = MathUtil.clamp(
                state.speedMetersPerSecond,
                -SwerveConfig.MAX_SPEED_METERS_PER_SECOND,
                SwerveConfig.MAX_SPEED_METERS_PER_SECOND);
        steerRadians = state.angle.getRadians();
    }
}
`,
  );
  files.set(
    'GyroIO.java',
    `package ${packageName};

/** Hardware boundary for robot heading. */
public interface GyroIO {
    final class Inputs {
        public boolean connected = true;
        public double yawRadians;
        public double yawVelocityRadiansPerSecond;
    }

    default void updateInputs(Inputs inputs) {}

    default void zero() {}
}
`,
  );
  files.set(
    'GyroIOPigeon2.java',
    `package ${packageName};

import com.ctre.phoenix6.hardware.Pigeon2;
import com.ctre.phoenix6.configs.Pigeon2Configuration;

/** Phoenix 6 Pigeon 2 gyro implementation. */
public final class GyroIOPigeon2 implements GyroIO {
    private final Pigeon2 pigeon = new Pigeon2(SwerveConfig.GYRO_ID, SwerveConfig.CAN_BUS);

    public GyroIOPigeon2() {
        Pigeon2Configuration configuration = new Pigeon2Configuration();
        configuration.MountPose.MountPoseRoll = SwerveConfig.GYRO_MOUNT_ROLL_DEGREES;
        configuration.MountPose.MountPosePitch = SwerveConfig.GYRO_MOUNT_PITCH_DEGREES;
        configuration.MountPose.MountPoseYaw = SwerveConfig.GYRO_MOUNT_YAW_DEGREES;
        pigeon.getConfigurator().apply(configuration);
    }

    @Override
    public void updateInputs(Inputs inputs) {
        inputs.connected = pigeon.isConnected();
        inputs.yawRadians = Math.toRadians(pigeon.getYaw().getValueAsDouble());
        inputs.yawVelocityRadiansPerSecond = Math.toRadians(pigeon.getAngularVelocityZWorld().getValueAsDouble());
    }

    @Override
    public void zero() {
        pigeon.setYaw(0.0);
    }
}
`,
  );
  files.set(
    'GyroIOSim.java',
    `package ${packageName};

/** Simulation gyro whose heading is integrated by the subsystem. */
public final class GyroIOSim implements GyroIO {
    private double yawRadians;

    public void setYawRadians(double value) {
        yawRadians = value;
    }

    @Override
    public void updateInputs(Inputs inputs) {
        inputs.connected = true;
        inputs.yawRadians = yawRadians;
        inputs.yawVelocityRadiansPerSecond = 0.0;
    }

    @Override
    public void zero() {
        yawRadians = 0.0;
    }
}
`,
  );
  files.set(
    'SwerveSubsystem.java',
    `package ${packageName};

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.math.kinematics.SwerveDriveKinematics;
import edu.wpi.first.math.kinematics.SwerveDriveOdometry;
import edu.wpi.first.math.kinematics.SwerveModulePosition;
import edu.wpi.first.math.kinematics.SwerveModuleState;
import edu.wpi.first.wpilibj.RobotBase;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.SubsystemBase;
import com.pathplanner.lib.auto.AutoBuilder;
import com.pathplanner.lib.config.PIDConstants;
import com.pathplanner.lib.config.RobotConfig;
import com.pathplanner.lib.controllers.PPHolonomicDriveController;
import java.util.function.DoubleSupplier;

/** Complete field-relative swerve drive generated from project.yaml. */
public final class SwerveSubsystem extends SubsystemBase {
    private final SwerveModuleIO[] modules = new SwerveModuleIO[4];
    private final SwerveModuleIO.Inputs[] inputs = new SwerveModuleIO.Inputs[4];
    private final GyroIO gyro;
    private final GyroIO.Inputs gyroInputs = new GyroIO.Inputs();
    private final SwerveDriveKinematics kinematics = new SwerveDriveKinematics(SwerveConfig.MODULE_LOCATIONS);
    private final SwerveDriveOdometry odometry;

    public SwerveSubsystem() {
        gyro = RobotBase.isReal() ? new GyroIOPigeon2() : new GyroIOSim();
        for (int index = 0; index < modules.length; index++) {
            modules[index] = RobotBase.isReal() ? new SwerveModuleIOTalonFX(index) : new SwerveModuleIOSim();
            inputs[index] = new SwerveModuleIO.Inputs();
        }
        odometry = new SwerveDriveOdometry(kinematics, new Rotation2d(), modulePositions());
        configurePathPlanner();
    }

    @Override
    public void periodic() {
        gyro.updateInputs(gyroInputs);
        for (int index = 0; index < modules.length; index++) {
            modules[index].updateInputs(inputs[index]);
        }
        odometry.update(Rotation2d.fromRadians(gyroInputs.yawRadians), modulePositions());
    }

    public void drive(double forwardMetersPerSecond, double leftMetersPerSecond, double omegaRadiansPerSecond, boolean fieldRelative) {
        ChassisSpeeds speeds = fieldRelative
                ? ChassisSpeeds.fromFieldRelativeSpeeds(forwardMetersPerSecond, leftMetersPerSecond, omegaRadiansPerSecond, getHeading())
                : new ChassisSpeeds(forwardMetersPerSecond, leftMetersPerSecond, omegaRadiansPerSecond);
        driveRobotRelative(speeds);
    }

    public void driveRobotRelative(ChassisSpeeds speeds) {
        SwerveModuleState[] states = kinematics.toSwerveModuleStates(ChassisSpeeds.discretize(speeds, 0.02));
        SwerveDriveKinematics.desaturateWheelSpeeds(states, SwerveConfig.MAX_SPEED_METERS_PER_SECOND);
        for (int index = 0; index < modules.length; index++) {
            modules[index].setDesiredState(states[index]);
        }
    }

    public Command teleopDriveCommand(DoubleSupplier forward, DoubleSupplier left, DoubleSupplier rotation) {
        return run(() -> drive(
                        forward.getAsDouble() * SwerveConfig.MAX_SPEED_METERS_PER_SECOND,
                        left.getAsDouble() * SwerveConfig.MAX_SPEED_METERS_PER_SECOND,
                        rotation.getAsDouble() * 2.0 * Math.PI,
                        true))
                .withName("Field-relative drive");
    }

    public Pose2d getPose() {
        return odometry.getPoseMeters();
    }

    public ChassisSpeeds getRobotRelativeSpeeds() {
        SwerveModuleState[] states = new SwerveModuleState[inputs.length];
        for (int index = 0; index < inputs.length; index++) {
            states[index] = new SwerveModuleState(
                    inputs[index].driveVelocityMetersPerSecond,
                    Rotation2d.fromRadians(inputs[index].steerAngleRadians));
        }
        return kinematics.toChassisSpeeds(states);
    }

    public Rotation2d getHeading() {
        return Rotation2d.fromRadians(gyroInputs.yawRadians);
    }

    public void resetPose(Pose2d pose) {
        odometry.resetPosition(getHeading(), modulePositions(), pose);
    }

    public void zeroHeading() {
        gyro.zero();
    }

    public void stop() {
        for (SwerveModuleIO module : modules) module.stop();
    }

    private void configurePathPlanner() {
        try {
            AutoBuilder.configure(
                    this::getPose,
                    this::resetPose,
                    this::getRobotRelativeSpeeds,
                    this::driveRobotRelative,
                    new PPHolonomicDriveController(
                            new PIDConstants(SwerveConfig.PATH_TRANSLATION_KP),
                            new PIDConstants(SwerveConfig.PATH_ROTATION_KP)),
                    RobotConfig.fromGUISettings(),
                    () -> DriverStation.getAlliance().orElse(DriverStation.Alliance.Blue)
                            == DriverStation.Alliance.Red,
                    this);
        } catch (Exception exception) {
            DriverStation.reportError("PathPlanner configuration failed: " + exception.getMessage(),
                    exception.getStackTrace());
        }
    }

    private SwerveModulePosition[] modulePositions() {
        SwerveModulePosition[] positions = new SwerveModulePosition[inputs.length];
        for (int index = 0; index < inputs.length; index++) positions[index] = inputs[index].position();
        return positions;
    }
}
`,
  );
  return files;
}

function generateLimelight(
  rootPackage: string,
  preset: PresetInstance,
): ReadonlyMap<string, string> {
  const packageName = `${rootPackage}.subsystems.vision`;
  const table = stringValue(preset, 'table');
  const pipeline = numberValue(preset, 'pipeline');
  const streamMode = numberValueOr(preset, 'streamMode', 0);
  const transform = numberArray(preset, 'transform', 6);
  const files = new Map<string, string>();
  files.set(
    'LimelightIO.java',
    `package ${packageName};

/** Hardware boundary for Limelight NetworkTables data. */
public interface LimelightIO {
    final class Inputs {
        public boolean connected;
        public boolean hasTarget;
        public double targetYawDegrees;
        public double targetPitchDegrees;
        public double latencySeconds;
        public double captureTimestampSeconds;
        public double[] robotPoseBlue = new double[0];
    }

    default void updateInputs(Inputs inputs) {}

    default void setPipeline(int pipeline) {}

    default void setStreamMode(int streamMode) {}
}
`,
  );
  files.set(
    'LimelightIONetworkTables.java',
    `package ${packageName};

import edu.wpi.first.networktables.NetworkTable;
import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.wpilibj.Timer;

/** NetworkTables implementation for Limelight ${escapeJava(table)}. */
public final class LimelightIONetworkTables implements LimelightIO {
    private final NetworkTable table = NetworkTableInstance.getDefault().getTable("${escapeJava(table)}");

    public LimelightIONetworkTables() {
        table.getEntry("camerapose_robotspace_set").setDoubleArray(new double[] {${transform.map(javaNumber).join(', ')}});
        setPipeline(${String(pipeline)});
        setStreamMode(${String(streamMode)});
    }

    @Override
    public void updateInputs(Inputs inputs) {
        double now = Timer.getFPGATimestamp();
        inputs.connected = table.getEntry("hb").getLastChange() > 0;
        inputs.hasTarget = table.getEntry("tv").getDouble(0.0) >= 1.0;
        inputs.targetYawDegrees = table.getEntry("tx").getDouble(0.0);
        inputs.targetPitchDegrees = table.getEntry("ty").getDouble(0.0);
        inputs.latencySeconds = (table.getEntry("tl").getDouble(0.0) + table.getEntry("cl").getDouble(0.0)) / 1000.0;
        inputs.captureTimestampSeconds = now - inputs.latencySeconds;
        inputs.robotPoseBlue = table.getEntry("botpose_wpiblue").getDoubleArray(new double[0]);
    }

    @Override
    public void setPipeline(int pipeline) {
        table.getEntry("pipeline").setNumber(pipeline);
    }

    @Override
    public void setStreamMode(int streamMode) {
        table.getEntry("stream").setNumber(streamMode);
    }
}
`,
  );
  files.set(
    'LimelightIOSim.java',
    `package ${packageName};

import edu.wpi.first.wpilibj.Timer;

/** Mutable simulation implementation suitable for tests and desktop simulation. */
public final class LimelightIOSim implements LimelightIO {
    private boolean hasTarget;
    private double yawDegrees;
    private double[] pose = new double[0];

    public void setObservation(boolean visible, double yaw, double[] robotPoseBlue) {
        hasTarget = visible;
        yawDegrees = yaw;
        pose = robotPoseBlue.clone();
    }

    @Override
    public void updateInputs(Inputs inputs) {
        inputs.connected = true;
        inputs.hasTarget = hasTarget;
        inputs.targetYawDegrees = yawDegrees;
        inputs.captureTimestampSeconds = Timer.getFPGATimestamp();
        inputs.robotPoseBlue = pose.clone();
    }
}
`,
  );
  files.set(
    'LimelightSubsystem.java',
    `package ${packageName};

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.wpilibj.RobotBase;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj2.command.SubsystemBase;
import java.util.Optional;

/** Limelight targeting and localization facade generated from project.yaml. */
public final class LimelightSubsystem extends SubsystemBase {
    private static final double STALE_AFTER_SECONDS = 0.25;
    private final LimelightIO io;
    private final LimelightIO.Inputs inputs = new LimelightIO.Inputs();

    public LimelightSubsystem() {
        io = RobotBase.isReal() ? new LimelightIONetworkTables() : new LimelightIOSim();
    }

    @Override
    public void periodic() {
        io.updateInputs(inputs);
    }

    public boolean isConnected() {
        return inputs.connected;
    }

    public boolean hasFreshTarget() {
        return inputs.hasTarget && Timer.getFPGATimestamp() - inputs.captureTimestampSeconds <= STALE_AFTER_SECONDS;
    }

    public double getTargetYawDegrees() {
        return inputs.targetYawDegrees;
    }

    public double getCaptureTimestampSeconds() {
        return inputs.captureTimestampSeconds;
    }

    public Optional<Pose2d> getEstimatedPoseBlue() {
        if (!hasFreshTarget() || inputs.robotPoseBlue.length < 6) return Optional.empty();
        return Optional.of(new Pose2d(
                inputs.robotPoseBlue[0],
                inputs.robotPoseBlue[1],
                Rotation2d.fromDegrees(inputs.robotPoseBlue[5])));
    }

    public void setPipeline(int pipeline) {
        if (pipeline < 0 || pipeline > 9) throw new IllegalArgumentException("pipeline must be between 0 and 9");
        io.setPipeline(pipeline);
    }

    public void setStreamMode(int streamMode) {
        if (streamMode < 0 || streamMode > 2) throw new IllegalArgumentException("stream mode must be between 0 and 2");
        io.setStreamMode(streamMode);
    }
}
`,
  );
  return files;
}

function swerveDocument(preset: PresetInstance): string {
  return `# Swerve Drive

This module was generated by the FRC Framework Swerve preset. It is ordinary WPILib/Phoenix Java and can be maintained without the desktop application.

## Geometry

- Wheelbase: ${String(numberValue(preset, 'wheelbase'))} m
- Trackwidth: ${String(numberValue(preset, 'trackwidth'))} m
- Wheel radius: ${String(numberValue(preset, 'wheelRadius'))} m
- Maximum speed: ${String(numberValue(preset, 'maxSpeed'))} m/s

## Calibration

1. Raise the robot safely and verify every module at low output.
2. Face all wheels forward and record the four absolute encoder offsets in \`project.yaml\`.
3. Verify motor inversion, Pigeon orientation, and field-relative direction.
4. Run simulation and a slow enabled test before increasing closed-loop gains.

## PathPlanner

The subsystem configures \`AutoBuilder\` with robot-relative speeds, pose reset, alliance mirroring, and translation/rotation gains (${String(numberValueOr(preset, 'pathTranslationKP', 5))}, ${String(numberValueOr(preset, 'pathRotationKP', 5))}). Keep PathPlanner's \`settings.json\` under \`src/main/deploy/pathplanner\`; its mass, moment of inertia, and module configuration are loaded at robot startup.

User notes may be added below the generated section and are preserved by FRC Framework.
`;
}

function limelightDocument(preset: PresetInstance): string {
  return `# Limelight Vision

This module reads the \`${stringValue(preset, 'table')}\` NetworkTables table and exposes target and blue-origin robot pose data.

## Configuration

- Pipeline: ${String(numberValue(preset, 'pipeline'))}
- Stream mode: ${String(numberValueOr(preset, 'streamMode', 0))}
- Robot-to-camera transform: ${numberArray(preset, 'transform', 6).join(', ')} (metres, degrees)

## Calibration

1. Measure the transform from the robot coordinate origin to the camera.
2. Confirm the camera name and pipeline in the Limelight web interface.
3. Validate blue-origin poses and capture timestamps before adding vision measurements to localization.

User notes may be added below the generated section and are preserved by FRC Framework.
`;
}

function value(preset: PresetInstance, key: string): ParameterValue {
  const result = preset.parameters[key];
  if (result === undefined) throw new Error(`Preset ${preset.presetId} is missing ${key}.`);
  return result;
}

function numberValue(preset: PresetInstance, key: string): number {
  const result = value(preset, key);
  if (typeof result !== 'number' || !Number.isFinite(result))
    throw new Error(`${key} must be a finite number.`);
  return result;
}

function numberValueOr(preset: PresetInstance, key: string, fallback: number): number {
  return preset.parameters[key] === undefined ? fallback : numberValue(preset, key);
}

function booleanValueOr(preset: PresetInstance, key: string, fallback: boolean): boolean {
  const result = preset.parameters[key];
  if (result === undefined) return fallback;
  if (typeof result !== 'boolean') throw new Error(`${key} must be a boolean.`);
  return result;
}

function stringValue(preset: PresetInstance, key: string): string {
  const result = value(preset, key);
  if (typeof result !== 'string') throw new Error(`${key} must be a string.`);
  return result;
}

function numberArray(preset: PresetInstance, key: string, length: number): readonly number[] {
  const result = value(preset, key);
  if (
    !Array.isArray(result) ||
    result.length !== length ||
    result.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
  ) {
    throw new Error(`${key} must contain ${String(length)} finite numbers.`);
  }
  return result as readonly number[];
}

function numberArrayOr(
  preset: PresetInstance,
  key: string,
  length: number,
  fallback: readonly number[],
): readonly number[] {
  return preset.parameters[key] === undefined ? fallback : numberArray(preset, key, length);
}

function javaNumber(value: number): string {
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

function escapeJava(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
