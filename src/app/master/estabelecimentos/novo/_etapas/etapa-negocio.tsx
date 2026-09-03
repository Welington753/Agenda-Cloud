import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import type { CategoriaNegocio } from "@/lib/types";
import type { EstadoFormulario } from "../page";
import { Campo, campoClasse } from "./campo";

interface EtapaNegocioProps {
  form: Pick<EstadoFormulario, "nome" | "nomeFantasia" | "categoria" | "documentoFiscal" | "telefone" | "email" | "endereco" | "fusoHorario">;
  aoMudarNome: (nome: string) => void;
  atualizar: <K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) => void;
}

export function EtapaNegocio({ form, aoMudarNome, atualizar }: EtapaNegocioProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Dados do negócio</CartaoTitulo>
        <Campo rotulo="Nome do estabelecimento">
          <input type="text" value={form.nome} onChange={(e) => aoMudarNome(e.target.value)} className={campoClasse} />
        </Campo>
        <Campo rotulo="Nome fantasia (opcional)">
          <input type="text" value={form.nomeFantasia} onChange={(e) => atualizar("nomeFantasia", e.target.value)} className={campoClasse} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Categoria">
            <select value={form.categoria} onChange={(e) => atualizar("categoria", e.target.value as CategoriaNegocio)} className={campoClasse}>
              {CATEGORIAS_NEGOCIO.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="CPF ou CNPJ (opcional)">
            <input type="text" value={form.documentoFiscal} onChange={(e) => atualizar("documentoFiscal", e.target.value)} className={campoClasse} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Telefone">
            <input type="text" value={form.telefone} onChange={(e) => atualizar("telefone", e.target.value)} className={campoClasse} />
          </Campo>
          <Campo rotulo="E-mail do negócio (opcional)">
            <input type="email" value={form.email} onChange={(e) => atualizar("email", e.target.value)} className={campoClasse} />
          </Campo>
        </div>
        <Campo rotulo="Endereço (unidade principal)">
          <input type="text" value={form.endereco} onChange={(e) => atualizar("endereco", e.target.value)} className={campoClasse} />
        </Campo>
        <Campo rotulo="Fuso horário">
          <select value={form.fusoHorario} onChange={(e) => atualizar("fusoHorario", e.target.value)} className={campoClasse}>
            <option value="America/Sao_Paulo">América/São Paulo (Brasília)</option>
            <option value="America/Manaus">América/Manaus</option>
            <option value="America/Rio_Branco">América/Rio Branco</option>
          </select>
        </Campo>
      </CartaoCorpo>
    </Cartao>
  );
}
