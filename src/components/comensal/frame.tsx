import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Pantalla móvil: encabezado y pie fijos, contenido en medio. Sin scroll horizontal. */
export function Screen({ top, foot, children }: { top?: ReactNode; foot?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col overflow-x-clip">
      {top && <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/70 px-4 py-3 backdrop-blur-xl">{top}</header>}
      <main className="flex flex-1 flex-col gap-4 px-4 py-4">{children}</main>
      {foot && (
        <footer className="sticky bottom-0 z-10 flex flex-col gap-2 border-t bg-background/70 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
          {foot}
        </footer>
      )}
    </div>
  );
}

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase();

/** Logo del negocio o, sin logo, sus iniciales. */
export function Mark({ name, logoUrl, className }: { name: string; logoUrl?: string | null; className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-primary font-display text-sm font-semibold text-primary-foreground", className)}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" aria-label={label} onClick={onClick} className="size-11 shrink-0 rounded-full p-0">
      <ChevronLeft className="size-5" />
    </Button>
  );
}

/** Botón grande de pie de pantalla. */
export const bigButton = "h-12 w-full justify-between rounded-xl px-4 text-base font-semibold";

/** Opción de una lista (radio o casilla nativos: teclado y lectores de pantalla gratis). Mínimo 44 px. */
export function ChoiceRow({
  type, name, checked, disabled, onChange, title, hint, price, icon,
}: {
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  hint?: string;
  price?: string;
  icon?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border bg-card px-4 py-2 text-sm transition-colors has-checked:border-gold has-checked:ring-1 has-checked:ring-gold has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} className="size-5 shrink-0 accent-(--gold)" />
      {icon}
      <span className="min-w-0 grow">
        <span className="block font-semibold">{title}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {price && <span className="shrink-0 text-muted-foreground">{price}</span>}
    </label>
  );
}

/** Lista de un pedido: cantidad, nombre, opciones, nota y total del renglón. */
export function LineList({ lines }: { lines: { key: string; qty: number; name: string; options: { name: string }[]; note: string | null; total: string }[] }) {
  return (
    <Card className="gap-3 p-4">
      {lines.map((l) => (
        <div key={l.key} className="flex items-start gap-3 text-sm">
          <span className="grow">
            <span className="font-semibold">{l.qty}× {l.name}</span>
            {l.options.length > 0 && <span className="block text-xs text-muted-foreground">{l.options.map((o) => o.name).join(", ")}</span>}
            {l.note && <span className="block text-xs text-muted-foreground">Nota: {l.note}</span>}
          </span>
          <span className="shrink-0 tabular-nums">{l.total}</span>
        </div>
      ))}
    </Card>
  );
}

export function Unavailable({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
        {action}
      </div>
    </Screen>
  );
}
