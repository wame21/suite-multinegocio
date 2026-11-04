import { OwnerShell } from "./_components/owner-shell";

export default function NegociosLayout({ children }: LayoutProps<"/negocios">) {
  return <OwnerShell>{children}</OwnerShell>;
}
