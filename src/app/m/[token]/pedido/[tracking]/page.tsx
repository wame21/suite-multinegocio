import { OrderTracker } from "@/components/comensal/order-tracker";

export default async function PedidoPage({ params }: PageProps<"/m/[token]/pedido/[tracking]">) {
  const { token, tracking } = await params;
  return <OrderTracker token={token} tracking={tracking} />;
}
