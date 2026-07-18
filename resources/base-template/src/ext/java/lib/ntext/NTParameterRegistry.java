package lib.ntext;

import edu.wpi.first.math.Pair;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

public class NTParameterRegistry {
    private static final List<NTParameterWrapper<?>> wrappers = new ArrayList<>();
    private static final List<Pair<NTParameterWrapper<?>, Consumer<Object>>> onchangeSiConsumers =
            new ArrayList<>();
    private static final List<Pair<NTParameterWrapper<?>, BiConsumer<Object, Object>>>
            onchangeBiConsumers = new ArrayList<>();

    // Master gate for live NT tuning. When false, refresh() is a no-op: no NetworkTables reads and
    // no onChange callbacks, so every @NTParameter value stays at its compile-time default. This
    // source set (src/ext) is compiled before frc.robot and cannot import RobotConstants, so the
    // flag is pushed in via setEnabled() at startup (see RobotConstants.ENABLE_NT_PARAMS).
    private static boolean enabled = true;

    // Tracks whether we've run the one-shot settle pass since the last time the gate flipped. See
    // refresh() for why disabling can't be a plain early-return.
    private static boolean settledWhileDisabled = false;

    /** Enable or disable live NT parameter updates. Off = refresh() stops reading NetworkTables. */
    public static void setEnabled(boolean value) {
        enabled = value;
        settledWhileDisabled = false; // re-settle on the next refresh after a state change
    }

    public static boolean isEnabled() {
        return enabled;
    }

    protected static void registerWrapper(NTParameterWrapper<?> wrapper) {
        wrappers.add(wrapper);
    }

    @SuppressWarnings("unchecked")
    protected static void registerOnChange(
            NTParameterWrapper<?> wrapper, BiConsumer<?, ?> functor) {
        BiConsumer<Object, Object> castedFunctor = (BiConsumer<Object, Object>) functor;
        onchangeBiConsumers.add(Pair.of(wrapper, castedFunctor));
    }

    @SuppressWarnings("unchecked")
    protected static void registerOnChange(NTParameterWrapper<?> wrapper, Consumer<?> functor) {
        Consumer<Object> castedFunctor = (Consumer<Object>) functor;
        onchangeSiConsumers.add(Pair.of(wrapper, castedFunctor));
    }

    public static void refresh() {
        if (!enabled) {
            // Gated off: never read NetworkTables. But we cannot just return, because every
            // wrapper starts with prevValue == null (hasChanged() == true by design, so the
            // default gets applied once). If we never advance prevValue,
            // hasChanged()/isAnyChanged()
            // stays true forever and every consumer that polls it re-applies its config on every
            // loop. So run exactly one pass: fire the onChange callbacks once (apply defaults, same
            // as the first enabled loop would) and settle every wrapper so it goes quiet after.
            if (!settledWhileDisabled) {
                fireOnChangeCallbacks();
                wrappers.forEach(NTParameterWrapper::settle);
                settledWhileDisabled = true;
            }
            return;
        }
        fireOnChangeCallbacks();
        wrappers.forEach(NTParameterWrapper::refresh);
    }

    private static void fireOnChangeCallbacks() {
        onchangeSiConsumers.forEach(
                pair -> {
                    if (pair.getFirst().hasChanged())
                        pair.getSecond().accept(pair.getFirst().getValue());
                });
        onchangeBiConsumers.forEach(
                pair -> {
                    if (pair.getFirst().hasChanged())
                        pair.getSecond()
                                .accept(
                                        pair.getFirst().getValue(),
                                        pair.getFirst().getPreviousValue());
                });
    }
}
