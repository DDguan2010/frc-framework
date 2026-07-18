package lib.ntext;

import edu.wpi.first.networktables.NetworkTableEntry;
import edu.wpi.first.networktables.NetworkTableInstance;
import java.util.Objects;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

public class NTParameterWrapper<T> {
    private final NetworkTableEntry entry;
    protected T value;
    protected T prevValue;

    public NTParameterWrapper(String tableName, T defaultValue) {
        entry = NetworkTableInstance.getDefault().getEntry(tableName);
        entry.setDefaultValue(defaultValue);
        value = defaultValue;
        prevValue = null; // NOTE: design choice to make change happen on default

        NTParameterRegistry.registerWrapper(this);
    }

    public T getValue() {
        return value; // must be correct, check at annotation processor
    }

    public T getPreviousValue() {
        return prevValue;
    }

    public boolean hasChanged() {
        return !Objects.equals(prevValue, value);
    }

    public void onChange(Consumer<T> current) {
        NTParameterRegistry.registerOnChange(this, current);
    }

    public void onChange(BiConsumer<T, T> currentPrevious) {
        NTParameterRegistry.registerOnChange(this, currentPrevious);
    }

    @SuppressWarnings("unchecked")
    public void refresh() {
        prevValue = value;
        T newValue = (T) entry.getValue().getValue();
        if (newValue != null) {
            value = newValue;
        }
    }

    /**
     * Advance change-tracking without touching NetworkTables. Used when live tuning is gated off:
     * the value stays at its compile-time default, but prevValue is caught up so hasChanged()
     * settles to false. Without this, prevValue stays null forever and every consumer that polls
     * hasChanged()/isAnyChanged() re-applies its config on every loop.
     */
    public void settle() {
        prevValue = value;
    }
}
