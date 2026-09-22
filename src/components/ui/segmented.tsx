/**
 * A choice among a few options (เดือน / ปี, ทั้งหมด / มี SOP / ยังไม่มี SOP).
 * The selected option is the primary role's tint, not a filled primary
 * button: a selection is not an action. Dark green on its tint is 6.9:1,
 * grey on white 7.8:1.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    // flex-wrap: on a phone a long set of options wraps instead of running
    // off the screen. Disabled with its form's fieldset, like any button.
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-neutral-300 bg-white p-0.5 shadow-btn-soft">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`h-8 rounded-md px-3 font-heading text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${
              on ? "bg-primary-soft text-primary shadow-[inset_0_0_0_1px_rgb(47_90_22/0.25)]" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
