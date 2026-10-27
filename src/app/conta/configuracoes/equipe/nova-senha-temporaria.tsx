"use client";

// Nova senha temporária para a conta de funcionário criada pelo dono com
// usuário e senha (o servidor confere: sem e-mail, sem papel na plataforma e
// só com este vínculo). As sessões abertas da pessoa são encerradas e ela
// troca a senha no próximo acesso. Pede a senha do dono.
import { useState } from "react";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import { ehNovaSenha } from "@/lib/equipe/acesso-por-usuario";
import type { MembroDaEquipe } from "@/lib/equipe/contratos";
import { SenhaTemporaria } from "./senha-temporaria";

export function NovaSenhaTemporaria({
  tenantId,
  acesso,
}: {
  tenantId: string;
  acesso: NonNullable<MembroDaEquipe["access"]>;
}) {
  const executarSensivel = useAcaoSensivel();
  const [perguntando, setPerguntando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState<{ username: string; temporaryPassword: string } | null>(null);

  async function gerar() {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    const r = await executarSensivel(() =>
      acaoAdministrativa(
        `/tenants/${encodeURIComponent(tenantId)}/team/members/${encodeURIComponent(acesso.membershipId)}/temporary-password`,
        "POST",
      ),
    );
    setOcupado(false);
    setPerguntando(false);
    if (r.tipo === "ok" && ehNovaSenha(r.dados)) setNova(r.dados);
    else if (r.tipo === "rede") {
      setErro("Não foi possível confirmar com o servidor. Se a senha mudou, gere outra: a anterior deixa de valer.");
    } else setErro(r.tipo === "ok" ? "Resposta inesperada do servidor." : mensagemDoResultado(r));
  }

  return (
    <div className="space-y-2">
      {nova ? (
        <SenhaTemporaria usuario={nova.username} senha={nova.temporaryPassword} aoFechar={() => setNova(null)} />
      ) : (
        <Botao type="button" variante="fantasma" className="min-h-11" onClick={() => setPerguntando(true)}>
          Gerar nova senha temporária
        </Botao>
      )}
      {erro && (
        <p role="alert" className="text-sm text-ink">
          {erro}
        </p>
      )}
      <Modal
        aberto={perguntando}
        aoFechar={() => !ocupado && setPerguntando(false)}
        titulo="Gerar nova senha temporária?"
        rodape={
          <>
            <Botao variante="secundaria" onClick={() => setPerguntando(false)} disabled={ocupado} className="min-h-11">
              Cancelar
            </Botao>
            <Botao onClick={() => void gerar()} disabled={ocupado} className="min-h-11">
              Gerar senha
            </Botao>
          </>
        }
      >
        <p>
          A senha atual de {acesso.user.name} deixa de valer e as sessões abertas dessa pessoa são encerradas. Ela entra
          com a senha nova e escolhe a própria senha antes de ver a agenda.
        </p>
      </Modal>
    </div>
  );
}
