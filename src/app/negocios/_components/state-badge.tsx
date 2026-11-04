import { Badge } from "@/components/ui/badge";
import { stateLabel } from "@/lib/owner";
import type { MembershipState } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLE: Record<MembershipState, string> = {
  activa: "bg-success/12 text-success ring-success/30",
  prueba: "bg-gold/15 text-gold ring-gold/35",
  gracia: "bg-warning/15 text-warning ring-warning/30",
  revision: "bg-ch-web/12 text-ch-web ring-ch-web/30",
  rechazada: "bg-destructive/10 text-destructive ring-destructive/25",
  vencida: "bg-destructive/10 text-destructive ring-destructive/25",
  suspendida: "bg-destructive/10 text-destructive ring-destructive/25",
};

export function StateBadge({ state, endsAt }: { state: MembershipState; endsAt: string | null }) {
  return (
    <Badge variant="outline" className={cn("border-0 ring-1", STYLE[state])}>
      {stateLabel(state, endsAt)}
    </Badge>
  );
}
