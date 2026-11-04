"use client";

import { PageHeader } from "@/components/erp";
import { useErp } from "@/lib/store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogoSection } from "./_components/catalogo";
import { MayoreoSection } from "./_components/mayoreo";
import { MembresiaSection } from "./_components/membresia";
import { NegocioSection } from "./_components/negocio";
import { RestoMenuSection } from "./_components/resto-menu";
import { RestoNegocioSection } from "./_components/resto-negocio";
import { RestoPagosSection } from "./_components/resto-pagos";
import { SucursalesSection } from "./_components/sucursales";
import { VentasSection } from "./_components/ventas";

const SECTIONS = [
  { value: "negocio", label: "Negocio", Section: NegocioSection },
  { value: "sucursales", label: "Sucursales", Section: SucursalesSection },
  { value: "catalogo", label: "Catálogo", Section: CatalogoSection },
  { value: "ventas", label: "Ventas", Section: VentasSection },
  { value: "mayoreo", label: "Mayoreo", Section: MayoreoSection },
  { value: "membresia", label: "Membresía", Section: MembresiaSection },
];

const RESTO_SECTIONS = [
  { value: "negocio", label: "Negocio", Section: RestoNegocioSection },
  { value: "pagos", label: "Pagos", Section: RestoPagosSection },
  { value: "menu", label: "Menú público", Section: RestoMenuSection },
  { value: "membresia", label: "Membresía", Section: MembresiaSection },
];

export default function ConfiguracionPage() {
  const resto = useErp((s) => s.kind) === "restaurante";
  const sections = resto ? RESTO_SECTIONS : SECTIONS;
  return (
    <>
      <PageHeader
        title="Configuración"
        description={
          resto
            ? "Negocio, pagos y cómo se ve tu menú público. Cada pestaña se guarda por separado."
            : "Los datos de tu negocio, sucursales, catálogo y ventas. Cada pestaña se guarda por separado y aplica a todo tu equipo."
        }
      />

      <Tabs defaultValue="negocio" className="gap-4">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="min-w-max">
            {sections.map((s) => (
              <TabsTrigger key={s.value} value={s.value} className="px-3">
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {sections.map(({ value, Section }) => (
          // Montadas siempre para no perder lo que se está editando al cambiar de pestaña
          <TabsContent key={value} value={value} forceMount className="data-[state=inactive]:hidden">
            <Section />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
