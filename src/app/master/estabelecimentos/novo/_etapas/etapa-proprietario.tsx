import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import type { EstadoFormulario } from "../page";
import { Campo, campoClasse } from "./campo";

interface EtapaProprietarioProps {
  form: Pick<EstadoFormulario, "donoNome" | "donoEmail" | "donoTelefone">;
  artigoFeminino: boolean;
  atualizar: <K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) => void;
}

export function EtapaProprietario({ form, artigoFeminino, atualizar }: EtapaProprietarioProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>{artigoFeminino ? "Proprietária" : "Proprietário"} do estabelecimento</CartaoTitulo>
        <Campo rotulo="Nome">
          <input type="text" value={form.donoNome} onChange={(e) => atualizar("donoNome", e.target.value)} className={campoClasse} />
        </Campo>
        <Campo rotulo="E-mail">
          <input type="email" value={form.donoEmail} onChange={(e) => atualizar("donoEmail", e.target.value)} className={campoClasse} />
        </Campo>
        <Campo rotulo="Telefone (opcional)">
          <input type="text" value={form.donoTelefone} onChange={(e) => atualizar("donoTelefone", e.target.value)} className={campoClasse} />
        </Campo>
        <p className="text-xs text-ink-soft">
          Nenhuma senha é definida aqui. Ao publicar, um convite simulado é criado para este e-mail — a pessoa
          &ldquo;aceita&rdquo; o convite (ação de demonstração) para ativar a própria conta.
        </p>
      </CartaoCorpo>
    </Cartao>
  );
}
