import type { InputHTMLAttributes, ReactNode } from "react";

type CardProps = { children: ReactNode; className?: string };
export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-xl border p-4 ${className}`} style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      {children}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement>;
export function Input(props: InputProps) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      style={{
        background: "var(--bg-input)",
        color: "var(--text-primary)",
        borderColor: "var(--border)",
      }}
      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--border-focus)] ${className}`}
    />
  );
}

type BadgeColor = "default" | "green" | "red" | "yellow" | "blue" | "purple";
export function Badge({ children, color = "default" }: { children: ReactNode; color?: BadgeColor }) {
  const colors: Record<BadgeColor, { bg: string; text: string }> = {
    default: { bg: "var(--bg-badge)", text: "var(--text-secondary)" },
    green: { bg: "#14532d", text: "#86efac" },
    red: { bg: "#450a0a", text: "#fca5a5" },
    yellow: { bg: "#422006", text: "#fcd34d" },
    blue: { bg: "#172554", text: "#93c5fd" },
    purple: { bg: "#3b0764", text: "#d8b4fe" },
  };
  const c = colors[color];

  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: c.bg, color: c.text }}>
      {children}
    </span>
  );
}

type ButtonVariant = "default" | "primary" | "danger" | "ghost" | "purple";
export function Button({
  variant = "default",
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, React.CSSProperties> = {
    default: { background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)" },
    primary: { background: "var(--text-primary)", color: "var(--text-inverse)", border: "none" },
    danger: { background: "transparent", color: "var(--accent-red)", border: "1px solid var(--accent-red)" },
    ghost: { background: "transparent", color: "var(--text-secondary)", border: "none" },
    purple: { background: "var(--accent-purple)", color: "#ffffff", border: "none" },
  };

  return (
    <button
      {...props}
      style={styles[variant]}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-opacity hover:opacity-80 ${className}`}
    >
      {children}
    </button>
  );
}

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close modal" />
      <div
        className="relative z-10 mx-4 w-full max-w-lg rounded-xl border p-6"
        style={{ background: "var(--bg-modal)", borderColor: "var(--border)" }}
      >
        {children}
      </div>
    </div>
  );
}

export function PageWrapper({
  title,
  subtitle,
  className = "",
  children,
}: {
  title?: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-h-screen p-6 ${className}`} style={{ background: "var(--bg-app)" }}>
      {title ? (
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
