"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuiteLockup } from "@/components/ui/suite-lockup";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/turnstile";
import { routeAfterLogin } from "@/lib/access";
import { KIND_LABEL } from "@/lib/constants";
import { passwordError } from "@/lib/password";
import { errorMessage } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";
import type { BusinessKind, OwnerBusiness } from "@/lib/types";

const AUTH_ERRORS: Record<string, string> = {
  "Invalid login credentials": "Correo o contraseña incorrectos",
  "User already registered": "Ese correo ya tiene cuenta; inicia sesión",
  "Email not confirmed": "Confirma tu correo antes de entrar",
  "email rate limit exceeded": "Se alcanzó el límite de correos de registro; intenta en una hora",
  "Signups not allowed for this instance": "El registro de cuentas está desactivado",
};

const CODE_LENGTH = 8;

type Mode = "entrar" | "crear" | "unirme";

function translate(message: string, mode: Mode) {
  if (AUTH_ERRORS[message]) return AUTH_ERRORS[message];
  if (message.startsWith("Password should")) return "La contraseña debe tener al menos 10 caracteres, con letras y números";
  if (message.startsWith("Email address")) return "Ese correo no es válido";
  if (message.includes("Código de invitación")) return "Código de invitación inválido";
  // Los errores del alta del negocio llegan de Supabase Auth con este mensaje genérico.
  if (message.startsWith("Database error saving new user")) {
    return mode === "unirme"
      ? "No pudimos crear tu cuenta. Revisa el código de invitación."
      : "No pudimos crear tu cuenta. Revisa los datos e intenta de nuevo.";
  }
  if (/captcha/i.test(message)) return "No pudimos verificar que eres una persona; intenta de nuevo";
  if (/rate limit|security purposes/i.test(message)) return "Demasiados intentos; espera un momento e inténtalo de nuevo";
  // Cualquier otro texto de Auth puede traer detalles internos: no se muestra.
  return "No se pudo completar la solicitud, intenta de nuevo";
}

/** Resultado de consultar un código: `name` es `null` si no existe. */
type Lookup = { code: string; name: string | null; kind: BusinessKind | null };

/** Texto lateral de cada pantalla de acceso (A1, A2 y A3). */
const COPY: Record<Mode, { title: string; text: string }> = {
  entrar: {
    title: "Todos tus negocios, en un solo lugar.",
    text: "Boutiques, cafeterías y restaurantes con sus ventas, pedidos y finanzas sincronizados en tiempo real.",
  },
  crear: {
    title: "Crea tu cuenta de dueño.",
    text: 'Primero tu cuenta; después das de alta cada negocio (boutique, cafetería o restaurante) desde "Mis negocios".',
  },
  unirme: {
    title: "¿Trabajas en un negocio?",
    text: "Pide el código de invitación al dueño. Entrarás directo a ese negocio con tu puesto: vendedor, encargado, mesero, cajero o cocina.",
  },
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("entrar");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", inviteCode: "" });
  const [confirmFocused, setConfirmFocused] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Token de Turnstile (un solo uso): `run` vuelve a dibujar el widget tras cada intento.
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  const code = form.inviteCode;
  const codeReady = code.length === CODE_LENGTH;
  const found = lookup?.code === code ? lookup : null;

  // Al completar el código se consulta el negocio (con una pausa para no consultar en cada tecla).
  useEffect(() => {
    if (mode !== "unirme" || !codeReady) return;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase().functions.invoke<{ name: string | null; kind: BusinessKind | null }>("invite-lookup", { body: { code } });
      if (error) {
        // La función responde { error } con el mensaje para el usuario (p. ej. el límite de intentos).
        const body = error.context instanceof Response ? await error.context.json().catch(() => null) : null;
        toast.error(body?.error ?? errorMessage(error));
      }
      setLookup({ code, name: error ? null : (data?.name ?? null), kind: data?.kind ?? null });
    }, 350);
    return () => clearTimeout(timer);
  }, [mode, code, codeReady]);

  const reset = (next: Mode) => {
    setMode(next);
    setError("");
    setNotice("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const email = form.email.trim().toLowerCase();
    const name = form.name.trim();
    const captchaToken = captcha ?? undefined;
    const { data, error } =
      mode === "entrar"
        ? await supabase().auth.signInWithPassword({ email, password: form.password, options: { captchaToken } })
        : await supabase().auth.signUp({
            email,
            password: form.password,
            options: {
              captchaToken,
              data: mode === "crear" ? { name } : { name, invite_code: code },
            },
          });
    setCaptcha(null);
    setRun((n) => n + 1);
    if (error) {
      setError(translate(error.message, mode));
      setBusy(false);
      return;
    }
    // Con "Confirm email" activo en Supabase el registro no abre sesión hasta confirmar el correo.
    if (!data.session) {
      setNotice(`Te enviamos un correo a ${email}. Confírmalo y luego inicia sesión.`);
      setMode("entrar");
      setBusy(false);
      return;
    }
    if (mode === "unirme") return router.replace("/");
    if (mode === "crear") return router.replace("/negocios");
    // Administrador, dueño o personal entran cada uno a su pantalla.
    const [admin, mine] = await Promise.all([supabase().rpc("is_platform_admin"), supabase().rpc("my_businesses")]);
    router.replace(mine.error ? "/" : routeAfterLogin(admin.data === true, mine.data as OwnerBusiness[]));
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setCode = (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, inviteCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH) }));

  const registro = mode !== "entrar";
  const codeInvalid = mode === "unirme" && found?.name === null;
  const confirmMismatch = registro && form.confirm !== form.password;
  const weakPassword = registro && form.password !== "" ? passwordError(form.password) : null;

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-14 gap-y-8">
        <div className="flex min-w-0 flex-[1_1_22rem] flex-col gap-6">
          <SuiteLockup />
          <h1 className="font-display text-3xl leading-[1.02] font-extrabold tracking-tight md:text-6xl">{COPY[mode].title}</h1>
          <p className="hidden max-w-md text-lg text-muted-foreground md:block">{COPY[mode].text}</p>
          {mode === "crear" && (
            <ol className="flex max-w-md flex-col gap-2 text-sm text-muted-foreground">
              {["Crea tu cuenta", "Agrega tu primer negocio y elige su giro", "Lo revisamos y lo activamos"].map((t, i) => (
                <li key={t} className="flex items-center gap-2.5">
                  <span className="grid size-6 place-items-center rounded-full bg-card text-xs font-semibold ring-1 ring-border">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          )}
          {mode === "entrar" && (
            <ul className="hidden flex-wrap gap-2.5 text-[13px] font-semibold md:flex">
              {["Boutique · punto de venta e inventario", "Restaurante · pedidos por QR y cocina", "Finanzas de todos tus negocios"].map((f) => (
                <li key={f} className="flex h-9 items-center gap-2 rounded-full border bg-card px-3.5 backdrop-blur-xl">
                  <span className="size-1.5 rounded-full bg-gold" />
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex w-full max-w-sm flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl font-bold">
                {mode === "entrar" ? "Inicia sesión" : mode === "crear" ? "Crear cuenta" : "Unirme a un negocio"}
              </CardTitle>
              <CardDescription>
                {mode === "entrar" && "Entra con el correo con que te registraste."}
                {mode === "crear" && "Solo tus datos. El nombre del negocio se pide al crearlo."}
                {mode === "unirme" && "El dueño aprobará tu acceso desde Equipo."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Tabs value={mode} onValueChange={(v) => reset(v as Mode)}>
                <TabsList className="w-full">
                  <TabsTrigger value="entrar">Entrar</TabsTrigger>
                  <TabsTrigger value="crear">Crear cuenta</TabsTrigger>
                  <TabsTrigger value="unirme">Tengo un código</TabsTrigger>
                </TabsList>
              </Tabs>
              <form onSubmit={submit} className="grid gap-3">
                {registro && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="name">Tu nombre</Label>
                    <Input id="name" required autoComplete="name" value={form.name} onChange={set("name")} placeholder="Ej. Karla López" />
                  </div>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="email">Correo</Label>
                  <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={registro ? 10 : undefined}
                    autoComplete={mode === "entrar" ? "current-password" : "new-password"}
                    value={form.password}
                    onChange={set("password")}
                    aria-invalid={!!weakPassword}
                  />
                  {weakPassword && <p className="text-sm text-destructive">{weakPassword}</p>}
                </div>
                {registro && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="confirm">Confirmar contraseña</Label>
                    <Input
                      id="confirm"
                      type="password"
                      required
                      autoComplete="new-password"
                      value={form.confirm}
                      onChange={set("confirm")}
                      onFocus={() => setConfirmFocused(true)}
                      onBlur={() => setConfirmFocused(false)}
                      aria-invalid={form.confirm !== "" && confirmMismatch}
                      aria-describedby="confirm-status"
                    />
                    {/* Se mantiene visible al salir del campo si ya escribió algo, para que se vea por qué el botón está desactivado. */}
                    <p id="confirm-status" aria-live="polite" className={confirmMismatch ? "text-sm text-destructive" : "text-sm text-success"}>
                      {(confirmFocused || form.confirm !== "") && (confirmMismatch ? "Las contraseñas no coinciden" : "Las contraseñas coinciden")}
                    </p>
                  </div>
                )}
                {mode === "unirme" && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="inviteCode">Código de invitación</Label>
                    <Input
                      id="inviteCode"
                      required
                      minLength={CODE_LENGTH}
                      maxLength={CODE_LENGTH}
                      autoComplete="off"
                      spellCheck={false}
                      value={form.inviteCode}
                      onChange={setCode}
                      placeholder="8 caracteres"
                      className="font-mono uppercase tracking-widest"
                    />
                    {codeReady && (
                      <p className={codeInvalid ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                        {!found ? (
                          "Buscando negocio…"
                        ) : found.name ? (
                          <>
                            Te unirás a <strong className="text-foreground">{found.name}</strong>
                            {found.kind && ` · ${KIND_LABEL[found.kind]}`}
                          </>
                        ) : (
                          "Código no encontrado"
                        )}
                      </p>
                    )}
                  </div>
                )}
                <Turnstile run={run} onToken={setCaptcha} />
                {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy || codeInvalid || confirmMismatch || !!weakPassword || (!!TURNSTILE_SITE_KEY && !captcha)} className="mt-1">
                  {busy && <Loader2 className="animate-spin" />}
                  {mode === "entrar" ? "Entrar" : mode === "crear" ? "Crear mi cuenta" : "Unirme al negocio"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
