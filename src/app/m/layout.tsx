import type { Metadata } from "next";

// Pantallas públicas del comensal (QR de la mesa): sin sesión y fuera de buscadores.
export const metadata: Metadata = { title: "Menú de la mesa", robots: { index: false, follow: false } };

export default function ComensalLayout({ children }: LayoutProps<"/m">) {
  return children;
}
