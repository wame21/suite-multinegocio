"use client";

import { Banknote, CreditCard, Landmark, Minus, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { mxnCents } from "@/lib/format";
import { fetchTableMenu, placeTableOrder, type PayMethod, type TableMenu } from "@/lib/restaurant";
import { MAX_QTY, minPicks, priceLine, type ModifierGroup, type PickedOption } from "@/lib/restaurant-pricing";
import { addLine, cartCount, cartTotal, lineTotal, readSaved, setQty, toOrderItems, writeSaved, type CartLine, type Saved } from "./cart";
import { BackButton, bigButton, ChoiceRow, Mark, Screen, Unavailable } from "./frame";

type Item = TableMenu["categories"][number]["items"][number];
type View = { v: "bienvenida" } | { v: "menu" } | { v: "producto"; item: Item } | { v: "carrito" } | { v: "pago" };

/** Pantallas E01 a E05 del comensal. El menú sale de `table_menu`; el carrito vive solo en este navegador. */
export function MenuApp({ token }: { token: string }) {
  const [data, setData] = useState<{ menu: TableMenu | null; saved: Saved } | "error" | undefined>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetchTableMenu(token).then(
      (menu) => live && setData({ menu, saved: readSaved(token) }),
      () => live && setData("error"),
    );
    return () => {
      live = false;
    };
  }, [token, attempt]);

  const retry = () => {
    setData(undefined);
    setAttempt((n) => n + 1);
  };
  const retryButton = <Button type="button" className={bigButton + " max-w-xs justify-center"} onClick={retry}>Reintentar</Button>;

  if (!data) {
    return (
      <Screen>
        <div className="flex flex-col gap-4 pt-16" aria-busy="true" aria-label="Cargando el menú">
          <Skeleton className="mx-auto size-20 rounded-full" />
          <Skeleton className="mx-auto h-8 w-48" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      </Screen>
    );
  }
  if (data === "error") return <Unavailable title="No pudimos cargar el menú" text="Revisa tu conexión e inténtalo de nuevo." action={retryButton} />;
  if (!data.menu) {
    return (
      <Unavailable
        title="Esta mesa no está disponible"
        text="El código ya no es válido o la mesa está desactivada. Pide ayuda al personal y te damos el QR correcto."
        action={retryButton}
      />
    );
  }
  return <Flow token={token} menu={data.menu} saved={data.saved} />;
}

function Flow({ token, menu, saved }: { token: string; menu: TableMenu; saved: Saved }) {
  const router = useRouter();
  const [name, setName] = useState(saved.name);
  const [cart, setCart] = useState(saved.cart);
  const [tracking, setTracking] = useState(saved.tracking);
  const [view, setView] = useState<View>({ v: saved.name.trim() ? "menu" : "bienvenida" });
  const [note, setNote] = useState("");

  useEffect(() => writeSaved(token, { name, cart, tracking }), [token, name, cart, tracking]);
  useEffect(() => window.scrollTo(0, 0), [view.v]);

  const total = cartTotal(cart);
  const go = (v: View["v"]) => setView({ v } as View);

  const top = (extra?: ReactNode) => (
    <>
      <Mark name={menu.business.name} logoUrl={menu.business.logoUrl} />
      <div className="min-w-0 grow">
        <div className="truncate font-semibold">{menu.business.name}</div>
        <div className="truncate text-xs text-muted-foreground">{menu.table.name} · hola, {name.trim()}</div>
      </div>
      {extra}
    </>
  );
  const title = (label: string, sub: string, back: () => void, backLabel: string) => (
    <>
      <BackButton label={backLabel} onClick={back} />
      <div className="min-w-0 grow">
        <div className="truncate text-lg font-semibold">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
    </>
  );

  if (view.v === "bienvenida") {
    return (
      <Screen
        foot={
          <Button type="submit" form="bienvenida" disabled={!name.trim()} className={bigButton + " justify-center"}>
            Ver el menú
          </Button>
        }
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-5 pt-6 text-center">
          <Mark name={menu.business.name} logoUrl={menu.business.logoUrl} className="size-20 text-2xl" />
          <div>
            <div className="text-sm text-muted-foreground">Bienvenido a</div>
            <h1 className="font-display text-4xl font-bold">{menu.business.name}</h1>
            {menu.business.welcome && <p className="mt-2 text-sm text-muted-foreground">{menu.business.welcome}</p>}
          </div>
          <Badge variant="outline" className="h-8 px-3 text-sm">{menu.table.name}{menu.table.area ? ` · ${menu.table.area}` : ""}</Badge>
          <Card className="w-full gap-3 p-5 text-left">
            <form id="bienvenida" onSubmit={(e) => { e.preventDefault(); if (name.trim()) go("menu"); }} className="flex flex-col gap-2">
              <Label htmlFor="comensal-nombre">¿Cómo te llamas?</Label>
              <Input id="comensal-nombre" className="h-12 text-base" value={name} maxLength={40} autoComplete="given-name" aria-describedby="comensal-nombre-ayuda" onChange={(e) => setName(e.target.value)} />
              <span id="comensal-nombre-ayuda" className="text-xs text-muted-foreground">Con tu nombre te avisamos cuando tu pedido esté listo. No necesitas cuenta.</span>
            </form>
          </Card>
        </div>
      </Screen>
    );
  }

  if (view.v === "menu") {
    return (
      <MenuList
        menu={menu}
        top={top(tracking && (
          <Button asChild variant="outline" className="h-11 shrink-0 px-3"><Link href={`/m/${token}/pedido/${tracking}`}>Mi pedido</Link></Button>
        ))}
        onPick={(item) => setView({ v: "producto", item })}
        foot={cart.length > 0 && (
          <Button type="button" onClick={() => go("carrito")} className={bigButton}>
            <span className="flex items-center gap-2"><Badge variant="secondary" className="h-6 min-w-6 px-1.5">{cartCount(cart)}</Badge>Ver carrito</span>
            <span className="tabular-nums">{mxnCents(total)}</span>
          </Button>
        )}
      />
    );
  }

  if (view.v === "producto") {
    return (
      <Product
        key={view.item.id}
        item={view.item}
        onBack={() => go("menu")}
        onAdd={(line) => {
          setCart((c) => addLine(c, line));
          go("menu");
        }}
      />
    );
  }

  if (view.v === "carrito") {
    return (
      <Screen
        top={title("Tu pedido", `${menu.table.name} · ${name.trim()}`, () => go("menu"), "Seguir pidiendo")}
        foot={cart.length > 0 && <Button type="button" onClick={() => go("pago")} className={bigButton + " justify-center"}>Continuar al pago</Button>}
      >
        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <ShoppingBag className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Tu carrito está vacío.</p>
            <Button type="button" variant="outline" className="h-11" onClick={() => go("menu")}>Ver el menú</Button>
          </div>
        ) : (
          <>
            <Card className="gap-4 p-4">
              {cart.map((l) => <CartRow key={l.key} line={l} onQty={(q) => setCart((c) => setQty(c, l.key, q))} />)}
            </Card>
            <div className="flex flex-col gap-2">
              <Label htmlFor="comensal-nota">Nota para todo el pedido</Label>
              <Textarea id="comensal-nota" value={note} maxLength={300} placeholder="Opcional" onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="button" variant="ghost" className="h-11 self-start px-0" onClick={() => go("menu")}>+ Agregar más productos</Button>
            <div className="mt-auto flex items-center justify-between border-t pt-4">
              <span className="text-lg font-semibold">Total</span>
              <span className="text-2xl font-bold tabular-nums">{mxnCents(total)}</span>
            </div>
          </>
        )}
      </Screen>
    );
  }

  return (
    <Payment
      menu={menu}
      total={total}
      sub={`${menu.table.name} · ${name.trim()}`}
      onBack={() => go("carrito")}
      onSend={async (method) => {
        const placed = await placeTableOrder({ token, name: name.trim(), items: toOrderItems(cart), note: note.trim() || undefined, method });
        writeSaved(token, { name, cart: [], tracking: placed.trackingToken });
        setCart([]);
        setTracking(placed.trackingToken);
        router.push(`/m/${token}/pedido/${placed.trackingToken}`);
      }}
    />
  );
}

function MenuList({ menu, top, foot, onPick }: { menu: TableMenu; top: ReactNode; foot: ReactNode; onPick: (item: Item) => void }) {
  const [catId, setCatId] = useState(menu.categories[0]?.id);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const cat = menu.categories.find((c) => c.id === catId);
  const items = query
    ? menu.categories.flatMap((c) => c.items).filter((i) => `${i.name} ${i.description}`.toLowerCase().includes(query))
    : (cat?.items ?? []);

  return (
    <Screen top={top} foot={foot}>
      <Input type="search" aria-label="Buscar en el menú" placeholder="Buscar en el menú" className="h-11" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Categorías">
        {menu.categories.map((c) => (
          <Button key={c.id} type="button" aria-pressed={!query && c.id === catId} variant={!query && c.id === catId ? "default" : "outline"} className="h-11 rounded-full px-4" onClick={() => { setQ(""); setCatId(c.id); }}>
            {c.name}
          </Button>
        ))}
      </div>
      <h2 className="text-lg font-semibold">{query ? "Resultados" : cat?.name}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{query ? "Nada coincide con tu búsqueda." : "Esta categoría no tiene platillos por ahora."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onPick(i)} className="flex min-h-20 w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Thumb item={i} className="size-16" />
                <span className="min-w-0 grow">
                  <span className="block font-semibold">{i.name}</span>
                  {i.description && <span className="line-clamp-2 text-xs text-muted-foreground">{i.description}</span>}
                  <span className="mt-1 block text-sm font-semibold text-gold tabular-nums">{mxnCents(i.price)}</span>
                </span>
                <Badge variant="secondary" className="h-6 shrink-0">{i.modifiers.length ? "Elegir" : "Agregar"}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function Thumb({ item, className }: { item: Item; className: string }) {
  return item.photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.photo} alt="" className={`${className} shrink-0 rounded-xl object-cover`} />
  ) : (
    <span aria-hidden className={`${className} grid shrink-0 place-items-center rounded-xl bg-muted font-display text-lg font-semibold text-muted-foreground`}>{item.name.charAt(0).toUpperCase()}</span>
  );
}

function Stepper({ qty, label, onChange, size = "size-11" }: { qty: number; label: string; onChange: (q: number) => void; size?: string }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" aria-label={`Quitar un ${label}`} className={`${size} p-0`} onClick={() => onChange(qty - 1)}><Minus /></Button>
      <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{qty}</span>
      <Button type="button" variant="outline" aria-label={`Agregar un ${label}`} disabled={qty >= MAX_QTY} className={`${size} p-0`} onClick={() => onChange(qty + 1)}><Plus /></Button>
    </div>
  );
}

function CartRow({ line, onQty }: { line: CartLine; onQty: (q: number) => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 grow">
        <div className="font-semibold">{line.name}</div>
        {line.options.length > 0 && <div className="text-xs text-muted-foreground">{line.options.map((o) => o.name).join(", ")}</div>}
        {line.note && <div className="text-xs text-muted-foreground">Nota: {line.note}</div>}
        <div className="mt-1 text-sm font-semibold tabular-nums">{mxnCents(lineTotal(line))}</div>
      </div>
      <Stepper qty={line.qty} label={line.name} onChange={onQty} />
    </div>
  );
}

function Product({ item, onBack, onAdd }: { item: Item; onBack: () => void; onAdd: (line: Omit<CartLine, "key">) => void }) {
  const [picks, setPicks] = useState<PickedOption[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [full, setFull] = useState<string | null>(null);

  const toggle = (g: ModifierGroup, optionId: string) =>
    setPicks((ps) => {
      const mine = ps.filter((p) => p.groupId === g.id);
      const rest = ps.filter((p) => p.groupId !== g.id);
      if (mine.some((p) => p.optionId === optionId)) return [...rest, ...mine.filter((p) => p.optionId !== optionId)];
      if (g.max === 1) return [...rest, { groupId: g.id, optionId }];
      return mine.length >= g.max ? ps : [...ps, { groupId: g.id, optionId }];
    });

  // El servidor vuelve a calcular todo; esto solo muestra el total y avisa qué falta elegir.
  const priced = useMemo(() => {
    try {
      return priceLine(item, picks, qty);
    } catch (e) {
      return e as Error;
    }
  }, [item, picks, qty]);
  const ready = !(priced instanceof Error);

  return (
    <Screen
      top={title(item)}
      foot={
        <>
          {!ready && <p className="text-xs text-muted-foreground" aria-live="polite">{priced.message}</p>}
          {full && <p role="alert" className="text-xs text-destructive">{full}</p>}
          <Button
            type="button"
            disabled={!ready}
            className={bigButton}
            onClick={() => {
              if (!ready) return;
              try {
                onAdd({ itemId: item.id, name: item.name, qty, unitPrice: priced.unitPrice, note, options: priced.options });
              } catch (e) {
                setFull((e as Error).message);
              }
            }}
          >
            <span>Agregar {qty} al carrito</span>
            <span className="tabular-nums">{ready ? mxnCents(priced.lineTotal) : mxnCents(item.price * qty)}</span>
          </Button>
        </>
      }
    >
      <Thumb item={item} className="h-40 w-full" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{item.name}</h1>
          {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
        </div>
        <span className="text-xl font-bold text-gold tabular-nums">{mxnCents(item.price)}</span>
      </div>
      {item.modifiers.map((g) => {
        const min = minPicks(g);
        const chosen = picks.filter((p) => p.groupId === g.id);
        const radio = g.max === 1 && min === 1;
        const rule = min === g.max ? `Elige ${g.max}` : min > 0 ? `Elige de ${min} a ${g.max}` : g.max > 1 ? `Opcional · hasta ${g.max}` : "Opcional";
        return (
          <fieldset key={g.id} className="flex flex-col gap-2">
            <legend className="mb-2 flex w-full items-center justify-between gap-2">
              <span className="font-semibold">{g.nombre}</span>
              <Badge variant={min > 0 ? "default" : "secondary"}>{min > 0 ? `Obligatorio · ${rule}` : rule}</Badge>
            </legend>
            {g.opciones.map((o) => {
              const checked = chosen.some((p) => p.optionId === o.id);
              return (
                <ChoiceRow
                  key={o.id}
                  type={radio ? "radio" : "checkbox"}
                  name={g.id}
                  checked={checked}
                  disabled={!o.disponible || (!checked && g.max > 1 && chosen.length >= g.max)}
                  onChange={() => toggle(g, o.id)}
                  title={o.nombre}
                  hint={o.disponible ? undefined : "Agotado"}
                  price={o.precio_extra > 0 ? `+${mxnCents(o.precio_extra)}` : undefined}
                />
              );
            })}
          </fieldset>
        );
      })}
      <div className="flex flex-col gap-2">
        <Label htmlFor="comensal-nota-platillo">Nota para cocina (opcional)</Label>
        <Textarea id="comensal-nota-platillo" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Cantidad</span>
        <Stepper qty={qty} label={item.name} onChange={(q) => setQty(Math.min(MAX_QTY, Math.max(1, q)))} />
      </div>
    </Screen>
  );

  function title(i: Item) {
    return (
      <>
        <BackButton label="Volver al menú" onClick={onBack} />
        <div className="min-w-0 grow truncate text-lg font-semibold">{i.name}</div>
      </>
    );
  }
}

const METHODS: { id: PayMethod; label: string; icon: ReactNode; hint: (m: TableMenu) => string }[] = [
  { id: "efectivo", label: "Efectivo", icon: <Banknote className="size-5" aria-hidden />, hint: () => "Pagas en caja o al mesero" },
  { id: "tarjeta", label: "Tarjeta", icon: <CreditCard className="size-5" aria-hidden />, hint: (m) => (m.cardAtTable ? "Un mesero llevará la terminal a tu mesa" : "Pagas con tarjeta en caja") },
  { id: "transferencia", label: "Transferencia", icon: <Landmark className="size-5" aria-hidden />, hint: () => "Te mostramos la CLABE del negocio" },
];

function Payment({ menu, total, sub, onBack, onSend }: { menu: TableMenu; total: number; sub: string; onBack: () => void; onSend: (m: PayMethod) => Promise<void> }) {
  const options = METHODS.filter((m) => menu.methods.includes(m.id));
  const [method, setMethod] = useState<PayMethod | undefined>(options[0]?.id);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!method || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(method);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  return (
    <Screen
      top={
        <>
          <BackButton label="Volver al carrito" onClick={onBack} />
          <div className="min-w-0 grow">
            <div className="text-lg font-semibold">¿Cómo vas a pagar?</div>
            <div className="truncate text-xs text-muted-foreground">Total {mxnCents(total)} · {sub}</div>
          </div>
        </>
      }
      foot={
        <>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="button" disabled={!method || sending} onClick={send} className={bigButton}>
            <span>{sending ? "Enviando…" : "Enviar pedido"}</span>
            <span className="tabular-nums">{mxnCents(total)}</span>
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Método de pago</legend>
        {options.map((m) => (
          <ChoiceRow key={m.id} type="radio" name="metodo" checked={method === m.id} onChange={() => setMethod(m.id)} title={m.label} hint={m.hint(menu)} icon={m.icon} />
        ))}
      </fieldset>
      {options.length === 0 && <p className="text-sm text-muted-foreground">Este negocio no tiene métodos de pago activos. Pide ayuda al personal.</p>}
      <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">Tu pedido pasa a cocina en cuanto confirmemos tu pago. Verás su estado aquí mismo.</p>
    </Screen>
  );
}
