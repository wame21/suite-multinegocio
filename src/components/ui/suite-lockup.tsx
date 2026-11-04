import { cn } from "@/lib/utils";

/** Marca de la cuenta (pantallas de acceso y cuenta del dueño), sin depender de ningún negocio. */
export function SuiteLockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-primary/20 font-display text-sm font-bold text-gold ring-1 ring-sidebar-primary/45">
        SU
      </div>
      <div className="truncate font-display text-lg font-bold uppercase tracking-[0.08em]">Suite de negocios</div>
    </div>
  );
}
