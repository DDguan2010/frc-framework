# IronPulse catalog audit

The component catalog deliberately treats the existing IronPulse sources as an API reference, not as a file-copy source. The optimized Base contains a small clean implementation of the stable Motor IO boundary; optional presets may add larger modules. The current compatibility review uses the 10541 offseason robot at commit `c0df8d87014e327f8d604d2753783e87eed3cdad` as the newest local reference.

| Capability | Existing source types | Framework catalog definition |
| --- | --- | --- |
| TalonFX Real/Sim | `MotorIO`, `MotorIOTalonFX`, `MotorIOSim`, `MotorInputs` | `ironpulse.talonfx-primary`, `ironpulse.talonfx-follower` |
| Generic motor subsystem | `MotorSubsystem`, `SubsystemConfig`, `ControlMode` | primary/follower parameter mappings |
| Position mechanism | `PositionMotorSubsystem`, `PositionParamSources` | `ironpulse.position-mechanism` |
| Velocity mechanism | `VelocityMotorSubsystem`, `VelocityParamSources` | `ironpulse.velocity-mechanism` |
| Absolute encoder | `CANCoderIO`, `CANCoderIOCANCoder`, `CANCoderIOSim` | `ironpulse.cancoder` |
| Gyro | `ImuIOPigeon`, `ImuIOSim`, `ImuPigeonConfig` | `ironpulse.pigeon2` |
| Beam break | `BeamBreakIOAnalog`, `BeamBreakIOSim`, `BeamBreak` | `ironpulse.beam-break` |
| Indicator | `IndicatorIOARGB`, `IndicatorIOSim`, `IndicatorSubsystem` | `ironpulse.indicator` |

Every catalog parameter records its type, category, default, optional unit/range/condition, whether it is commonly shown, whether it may be tuned, and its Java generator path. Optional parameters are omitted from output until selected. This prevents the UI from dumping every Phoenix field into ordinary robot code while still making advanced fields searchable. Catalog v2 adds the current remote CANcoder bus/magnet/direction fields, static-feedforward sign, mechanism zero offset, and zeroing filter length. The compatibility MotorIO also accepts the unit-based method names used in 10541 while preserving the existing compact API.
