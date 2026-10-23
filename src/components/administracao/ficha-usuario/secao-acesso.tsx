"use client";

// Acesso por e-mail: convites desta conta (com o estado do envio) e a
// redefinição de senha. A administração nunca vê nem escolhe a senha: só
// manda o link para o e-mail da conta. Concluída a redefinição, as sessões
// abertas são encerradas.
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge-base";
import { SituacaoDoConvite } from "@/components/administracao/estado-envio";
import { AcoesConvite } from "@/components/administracao/acoes-convite";
import { ResultadoEnvio } from "@/components/administracao/resultado-envio";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { useEnvioComChave } from "@/lib/administracao/use-envio-com-chave";
import { corEnvio, dataHora, textoEnvio } from "@/lib/administracao/rotulos";
import type { RedefinicaoSenha } from "@/lib/administracao/contas";
import { BotaoConfirmado, type SecaoProps } from "./comum";

const SITUACAO_REDEFINICAO: Record<RedefinicaoSenha["status"], string> = {
  PENDING: "Link pendente",
  USED: "Senha redefinida",
  REVOKED: "Substituído por um pedido mais novo",
  EXPIRED: "Link expirado",
};

function ehResultadoRedefinicao(v: unknown): v is { created: boolean; reset: RedefinicaoSenha } {
  return typeof v === "object" && v !== null && "reset" in v && typeof (v as { created?: unknown }).created === "boolean";
}

export function SecaoAcesso({ ficha, aoMudar }: SecaoProps) {
  const envio = useEnvioComChave(ehResultadoRedefinicao);
  const ultima = ficha.latestPasswordReset;

  function pedir() {
    void envio
      .enviar((requestKey) =>
        acaoAdministrativa(`/platform/users/${encodeURIComponent(ficha.id)}/password-reset`, "POST", { requestKey }),
      )
      .then(aoMudar);
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <h2 className="font-semibold">Acesso por e-mail</h2>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Redefinição de senha</h3>
          {ultima && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{SITUACAO_REDEFINICAO[ultima.status]}</Badge>
              {ultima.status === "PENDING" && <Badge cor={corEnvio(ultima.delivery.status)}>{textoEnvio(ultima.delivery)}</Badge>}
              <span className="text-xs text-ink-soft">
                Pedido por {ultima.requestedBy.name} em {dataHora(ultima.createdAt)}
              </span>
            </div>
          )}
          {ficha.allowedActions.resetPassword ? (
            <BotaoConfirmado
              rotulo="Enviar link de redefinição"
              titulo="Enviar link de redefinição de senha?"
              confirmar="Enviar"
              disabled={envio.estado.fase === "enviando" || envio.estado.fase === "incerto"}
              texto={
                <p>
                  Um link vai para {ficha.email}, válido por 24 horas. A senha atual continua valendo até a pessoa criar a
                  nova; depois disso, as sessões abertas são encerradas. Um pedido anterior deixa de valer.
                </p>
              }
              aoConfirmar={() => {
                envio.recomecar();
                pedir();
              }}
            />
          ) : (
            <p className="text-sm text-ink-soft">
              {ficha.status === "INVITED"
                ? "A conta ainda não foi ativada: reenvie o convite em vez de redefinir a senha."
                : "Disponível só para conta ativa com senha, e para quem pode alterar esta conta."}
            </p>
          )}
          <ResultadoEnvio
            estado={envio.estado}
            aoConsultar={() => void envio.consultar()}
            sucesso={(dados) => (
              <p role="status" className="text-sm">
                {dados.created ? textoEnvio(dados.reset.delivery) : "Este pedido já tinha sido feito."}
              </p>
            )}
          />
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Convites desta conta</h3>
          {ficha.invites.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhum convite registrado (conta anterior aos convites).</p>
          ) : (
            ficha.invites.map((convite) => (
              <div key={convite.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                <p className="break-words">
                  {convite.tenant ? convite.tenant.name : "Administração da plataforma"} · criado por {convite.createdBy.name} em{" "}
                  {dataHora(convite.createdAt)}
                </p>
                <SituacaoDoConvite convite={convite} detalhar />
                {ficha.allowedActions.manageMemberships && <AcoesConvite convite={convite} aoMudar={aoMudar} />}
              </div>
            ))
          )}
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
