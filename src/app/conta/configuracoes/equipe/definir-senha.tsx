"use client";

// "Definir nova senha" para a conta de funcionário criada pelo dono com login
// interno (o servidor confere: sem e-mail, sem papel na plataforma e só com
// este vínculo). A senha nova é definitiva, a anterior deixa de valer e as
// sessões abertas da pessoa são encerradas. Pede a senha do dono.
//
// A senha fica só na memória deste quadro: fechar ou concluir a descarta, e
// a resposta do servidor nunca a traz de volta.
import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import { ehSenhaDefinida } from "@/lib/equipe/acesso-por-usuario";
import { senhaPronta } from "@/lib/equipe/senha-do-acesso";
import type { MembroDaEquipe } from "@/lib/equipe/contratos";
import { CamposDeSenha } from "./campos-de-senha";

export function DefinirSenha({
  tenantId,
  acesso,
}: {
  tenantId: string;
  acesso: NonNullable<MembroDaEquipe["access"]>;
}) {
  const executarSensivel = useAcaoSensivel();
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [definida, setDefinida] = useState(false);
  const pronta = senhaPronta(senha, confirmacao);

  function limpar() {
    setSenha("");
    setConfirmacao("");
  }

  function fechar() {
    if (ocupado) return;
    limpar();
    setErro(null);
    setAberto(false);
  }

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (!pronta || ocupado) return;
    setOcupado(true);
    setErro(null);
    const r = await executarSensivel(() =>
      acaoAdministrativa(
        `/tenants/${encodeURIComponent(tenantId)}/team/members/${encodeURIComponent(acesso.membershipId)}/password`,
        "PUT",
        { password: senha },
      ),
    );
    setOcupado(false);
    if (r.tipo === "ok" && ehSenhaDefinida(r.dados)) {
      limpar();
      setAberto(false);
      setDefinida(true);
    } else if (r.tipo === "rede") {
      // Repetir com a MESMA senha é seguro: o resultado é o mesmo.
      setErro("Não foi possível confirmar com o servidor. A senha pode ter mudado: envie de novo para garantir.");
    } else {
      setErro(r.tipo === "ok" ? "Resposta inesperada do servidor." : mensagemDoResultado(r));
    }
  }

  if (!aberto) {
    return (
      <div className="space-y-2">
        <Botao
          type="button"
          variante="fantasma"
          className="min-h-11"
          onClick={() => {
            setDefinida(false);
            setAberto(true);
          }}
        >
          <KeyRound size={16} aria-hidden="true" />
          Definir nova senha
        </Botao>
        {definida && (
          <p role="status" className="text-sm text-ink-soft" data-testid="senha-definida">
            Nova senha definida para {acesso.user.name}. A anterior deixou de valer e as sessões abertas foram
            encerradas.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void aoEnviar(e)}
      className="space-y-3 rounded-xl border border-border p-3"
      data-testid="definir-senha"
      aria-label={`Definir nova senha para ${acesso.user.name}`}
    >
      <p className="text-sm text-ink">
        A senha atual de {acesso.user.name} deixa de valer e as sessões abertas dessa pessoa são encerradas. Ela entra
        com a senha nova, sem precisar trocar.
      </p>
      <fieldset disabled={ocupado} className="space-y-3">
        <CamposDeSenha
          senha={senha}
          confirmacao={confirmacao}
          aoMudarSenha={setSenha}
          aoMudarConfirmacao={setConfirmacao}
          prefixo="nova-senha"
        />
      </fieldset>
      {erro && (
        <p role="alert" className="text-sm text-ink">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" className="min-h-11" disabled={!pronta || ocupado} aria-busy={ocupado}>
          {ocupado ? "Salvando..." : "Salvar nova senha"}
        </Botao>
        <Botao type="button" variante="secundaria" className="min-h-11" onClick={fechar} disabled={ocupado}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
