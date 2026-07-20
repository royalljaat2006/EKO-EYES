import type { Theme } from "../useTheme";

const THEMES: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "eko", label: "Eko", icon: "◉" },
];

interface Props {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

export default function ThemeSwitcher({ theme, onChange }: Props) {
  return (
    <div className="theme-switcher" role="group" aria-label="Colour theme">
      {THEMES.map((t) => {
        const selected = t.value === theme;
        return (
          <button
            key={t.value}
            type="button"
            className={`theme-button${selected ? " theme-button--selected" : ""}`}
            aria-pressed={selected}
            onClick={() => onChange(t.value)}
          >
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
