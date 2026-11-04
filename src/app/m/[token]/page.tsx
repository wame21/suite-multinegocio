import { MenuApp } from "@/components/comensal/menu-app";

export default async function MesaPage({ params }: PageProps<"/m/[token]">) {
  const { token } = await params;
  return <MenuApp token={token} />;
}
