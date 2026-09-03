import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import { ROTULO_FEATURE, type DefinicaoPlano } from "@/lib/planos";
import type { EstadoFormulario } from "../page";
import { LinhaResumo } from "./campo";

interface EtapaRevisaoProps {
  form: Pick<EstadoFormulario, "nome" | "categoria" | "maxProfissionais" | "maxUnidades" | "featuresDesativadas" | "slug" | "modelo" | "donoNome" | "donoEmail">;
  definicaoPlano: DefinicaoPlano;
}

export function EtapaRevisao({ form, definicaoPlano }: EtapaRevisaoProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-3">
        <CartaoTitulo>Revisão</CartaoTitulo>
        <LinhaResumo rotulo="Nome" valor={form.nome} />
        <LinhaResumo rotulo="Categoria" valor={CATEGORIAS_NEGOCIO.find((c) => c.valor === form.categoria)?.rotulo ?? form.categoria} />
        <LinhaResumo rotulo="Plano" valor={`${definicaoPlano.nome} — ${form.maxProfissionais} profissionais, ${form.maxUnidades} unidade(s)`} />
        <LinhaResumo
          rotulo="Funcionalidades desativadas"
          valor={form.featuresDesativadas.length === 0 ? "Nenhuma" : form.featuresDesativadas.map((f) => ROTULO_FEATURE[f]).join(", ")}
        />
        <LinhaResumo rotulo="Slug público" valor={`/${form.slug}`} />
        <LinhaResumo rotulo="Modelo de página" valor={form.modelo} />
        <LinhaResumo rotulo="Proprietário" valor={`${form.donoNome} (${form.donoEmail})`} />
        <LinhaResumo rotulo="Status inicial" valor="Em teste" />
      </CartaoCorpo>
    </Cartao>
  );
}
