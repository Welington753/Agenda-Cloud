"use client";

// Um profissional do estabelecimento e a situação do acesso dele. As ações
// aparecem conforme a situação; o servidor confere cada uma de novo (vaga,
// profissional ativo, conta bloqueada, permissões que o dono pode dar).
//
// Suspender, reativar, remover e mudar permissões pedem a senha do dono
// (useAcaoSensivel, a mesma reautenticação da administração).
import { useState } from "react";
import { Badge, type CorBadge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, mensagemDoResultado, type ResultadoAcao } from "@/lib/administracao/api-contas";
import { dataHora, textoEnvio } from "@/lib/administracao/rotulos";
import {
  ROTULO_SITUACAO,
  type MembroDaEquipe,
  type PermissaoFuncionario,
  type SituacaoNaEquipe,
  type VisaoDaEquipe,
} from "@/lib/equipe/contratos";
import { ConvidarFuncionario } from "./convidar-funcionario";
import { CriarAcessoUsuario } from "./criar-acesso-usuario";
import { NovaSenhaTemporaria } from "./nova-senha-temporaria";

const COR_SITUACAO: Record<SituacaoNaEquipe, CorBadge> = {
  OWNER: "destaque",
  ACTIVE: "sucesso",
  SUSPENDED: "aviso",
  PROFESSIONAL_INACTIVE: "neutro",
  INVITED: "info",
  NO_ACCESS: "neutro",
};

type Pergunta = "suspender" | "reativar" | "remover" | "revogar" | "reenviar";

const TEXTO_PERGUNTA: Record<Pergunta, { titulo: string; botao: string; perigo?: boolean }> = {
  suspender: { titulo: "Suspender o acesso?", botao: "Suspender acesso" },
  reativar: { titulo: "Reativar o acesso?", botao: "Reativar acesso" },
  remover: { titulo: "Remover o acesso?", botao: "Remover acesso", perigo: true },
  revogar: { titulo: "Revogar o convite?", botao: "Revogar convite", perigo: true },
  reenviar: { titulo: "Reenviar o convite?", botao: "Reenviar" },
};

function explicacao(pergunta: Pergunta, membro: MembroDaEquipe): string {
  const pessoa = membro.access?.user.name ?? membro.invite?.email ?? "";
  switch (pergunta) {
    case "suspender":
      return `${pessoa} deixa de acessar este estabelecimento já na próxima ação, mesmo com o aplicativo aberto. A conta, a senha e o acesso a outros estabelecimentos continuam. A vaga do plano fica livre; reativar depois depende de haver vaga.`;
    case "reativar":
      return `${pessoa} volta a ver a própria agenda neste estabelecimento, com as permissões que tinha. Ocupa de novo uma vaga do plano.`;
    case "remover":
      return `O vínculo de ${pessoa} com este estabelecimento é apagado, com as permissões dele. A conta da pessoa, o acesso a outros estabelecimentos, o cadastro do profissional e as reservas continuam. Para dar acesso de novo, é preciso outro convite.`;
    case "revogar":
      return `O link enviado para ${membro.invite?.email} deixa de funcionar e a vaga do plano fica livre. A conta da pessoa não é apagada.`;
    case "reenviar":
      return `Um link novo vai para ${membro.invite?.email}, válido por 24 horas. O link anterior deixa de funcionar. Não ocupa outra vaga.`;
  }
}

export function MembroEquipe({ membro, visao, aoMudar }: { membro: MembroDaEquipe; visao: VisaoDaEquipe; aoMudar: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { notificar } = useToast();
  // "convite": por e-mail; "usuario": com nome de usuário e senha temporária.
  const [criando, setCriando] = useState<"convite" | "usuario" | null>(null);
  const convidando = criando !== null;
  const [pergunta, setPergunta] = useState<Pergunta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const tenantId = visao.tenant.id;
  const base = `/tenants/${encodeURIComponent(tenantId)}/team`;
  const acesso = membro.access;
  const convite = membro.invite;
  const [marcadas, setMarcadas] = useState<PermissaoFuncionario[]>(acesso?.grantedPermissions ?? []);
  const permissoesMudaram =
    !!acesso && JSON.stringify([...marcadas].sort()) !== JSON.stringify([...acesso.grantedPermissions].sort());
  const podeConceder = (p: PermissaoFuncionario) => visao.grantablePermissions.some((g) => g.permission === p);
  const semVaga = visao.seats.available === 0;

  function responder(r: ResultadoAcao<unknown>, sucesso: string) {
    // Sucesso vira aviso (a linha é remontada com o estado novo do servidor);
    // recusa fica na própria linha, com o motivo.
    if (r.tipo === "ok") {
      setMensagem("");
      notificar(sucesso, "sucesso");
      aoMudar();
    } else setMensagem(mensagemDoResultado(r));
  }

  async function confirmar() {
    if (!pergunta || ocupado) return;
    setOcupado(true);
    const membro = acesso ? encodeURIComponent(acesso.membershipId) : "";
    const conviteId = convite ? encodeURIComponent(convite.id) : "";
    let r: ResultadoAcao<unknown>;
    let sucesso: string;
    switch (pergunta) {
      case "suspender":
        r = await executarSensivel(() => acaoAdministrativa(`${base}/members/${membro}/suspend`, "POST"));
        sucesso = "Acesso suspenso.";
        break;
      case "reativar":
        r = await executarSensivel(() => acaoAdministrativa(`${base}/members/${membro}/reactivate`, "POST"));
        sucesso = "Acesso reativado.";
        break;
      case "remover":
        r = await executarSensivel(() => acaoAdministrativa(`${base}/members/${membro}`, "DELETE"));
        sucesso = "Acesso removido.";
        break;
      case "revogar":
        r = await acaoAdministrativa(`${base}/invites/${conviteId}/revoke`, "POST");
        sucesso = "Convite revogado.";
        break;
      case "reenviar":
        r = await acaoAdministrativa(`${base}/invites/${conviteId}/resend`, "POST");
        sucesso = "Novo link emitido.";
        break;
    }
    setOcupado(false);
    setPergunta(null);
    responder(r, sucesso);
  }

  async function salvarPermissoes() {
    if (!acesso || ocupado) return;
    setOcupado(true);
    const r = await executarSensivel(() =>
      acaoAdministrativa(`${base}/members/${encodeURIComponent(acesso.membershipId)}/permissions`, "PUT", {
        expectedGranted: acesso.grantedPermissions,
        granted: marcadas,
      }),
    );
    setOcupado(false);
    responder(r, "Permissões salvas. Valem a partir da próxima ação da pessoa.");
  }

  return (
    <li className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-soft)]" data-testid="membro-equipe">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold text-ink">{membro.professional.name}</p>
          {acesso && (
            <p className="break-all text-sm text-ink-soft" data-testid="identificacao-acesso">
              {acesso.user.name} · {acesso.user.hasEmail === false ? `usuário ${acesso.user.email}` : acesso.user.email}
            </p>
          )}
          {!acesso && convite && <p className="break-all text-sm text-ink-soft">Convite para {convite.email}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge cor={COR_SITUACAO[membro.situation]}>{ROTULO_SITUACAO[membro.situation]}</Badge>
          {acesso?.user.status === "SUSPENDED" && <Badge cor="erro">Conta bloqueada pela plataforma</Badge>}
        </div>
      </div>

      {membro.situation === "OWNER" && (
        <p className="text-xs text-ink-soft">Acesso de dono(a): não ocupa vaga de funcionário. O cadastro de profissional conta no limite do plano.</p>
      )}
      {!membro.professional.active && (
        <p className="text-xs text-ink-soft">
          Profissional desativado: sem reservas novas
          {acesso && !acesso.isOwner ? " e o acesso de funcionário não funciona até a reativação" : ""}.
          {membro.professional.futureAppointments > 0 &&
            ` ${membro.professional.futureAppointments} reserva(s) futura(s) continua(m) na agenda dele e precisam de tratamento.`}
        </p>
      )}
      {convite && (
        <p className="text-xs text-ink-soft">
          Link válido até {dataHora(convite.expiresAt)} · {convite.sendCount} de {visao.maxInviteSends} links emitidos ·{" "}
          {textoEnvio(convite.delivery)}
          {convite.accountExists ? " · e-mail com conta: a pessoa aceita com a senha dela" : ""}
        </p>
      )}

      {acesso && !acesso.isOwner && (
        <fieldset className="space-y-2" disabled={ocupado}>
          <legend className="text-sm font-semibold text-ink">O que esta pessoa pode fazer</legend>
          <p className="text-xs text-ink-soft">Sempre: ver a própria agenda (data, horário, cliente, serviço e situação).</p>
          {visao.permissionLabels.map(({ permission, label }) => {
            const marcada = marcadas.includes(permission);
            const bloqueada = !marcada && !podeConceder(permission);
            return (
              <label key={permission} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={marcada}
                  disabled={bloqueada}
                  onChange={(e) =>
                    setMarcadas((atual) => (e.target.checked ? [...atual, permission] : atual.filter((p) => p !== permission)))
                  }
                />
                <span>
                  {label}
                  {bloqueada && <span className="block text-xs text-ink-soft">Você não pode liberar o que não pode fazer.</span>}
                </span>
              </label>
            );
          })}
          {permissoesMudaram && (
            <div className="flex flex-wrap gap-2">
              <Botao type="button" className="min-h-11" onClick={() => void salvarPermissoes()}>
                Salvar permissões
              </Botao>
              <Botao type="button" variante="fantasma" className="min-h-11" onClick={() => setMarcadas(acesso.grantedPermissions)}>
                Desfazer
              </Botao>
            </div>
          )}
        </fieldset>
      )}

      <div className="flex flex-wrap gap-2">
        {membro.situation === "NO_ACCESS" && membro.professional.active && !convidando && (
          <>
            <Botao type="button" className="min-h-11" disabled={semVaga} onClick={() => setCriando("convite")}>
              Convidar por e-mail
            </Botao>
            <Botao type="button" variante="secundaria" className="min-h-11" disabled={semVaga} onClick={() => setCriando("usuario")}>
              Criar usuário e senha
            </Botao>
          </>
        )}
        {convite && (
          <>
            {convite.sendCount < visao.maxInviteSends && (
              <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setPergunta("reenviar")}>
                Reenviar convite
              </Botao>
            )}
            <Botao type="button" variante="fantasma" className="min-h-11" onClick={() => setPergunta("revogar")}>
              Revogar convite
            </Botao>
          </>
        )}
        {acesso && !acesso.isOwner && acesso.status === "ACTIVE" && (
          <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setPergunta("suspender")}>
            Suspender acesso
          </Botao>
        )}
        {acesso && !acesso.isOwner && acesso.status === "SUSPENDED" && (
          <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setPergunta("reativar")}>
            Reativar acesso
          </Botao>
        )}
        {acesso && !acesso.isOwner && (
          <Botao type="button" variante="fantasma" className="min-h-11" onClick={() => setPergunta("remover")}>
            Remover acesso
          </Botao>
        )}
      </div>
      {membro.situation === "NO_ACCESS" && membro.professional.active && semVaga && !convidando && (
        <p className="text-xs text-ink-soft">Sem vaga no plano para outro acesso. Revogue um convite, suspenda ou remova um acesso.</p>
      )}
      {criando === "convite" && (
        <ConvidarFuncionario
          tenantId={tenantId}
          professional={membro.professional}
          aoCancelar={() => setCriando(null)}
          aoConcluir={() => {
            setCriando(null);
            aoMudar();
          }}
        />
      )}
      {criando === "usuario" && (
        <CriarAcessoUsuario
          visao={visao}
          professional={membro.professional}
          aoCancelar={() => setCriando(null)}
          aoConcluir={() => {
            setCriando(null);
            aoMudar();
          }}
        />
      )}
      {acesso?.canResetTemporaryPassword && <NovaSenhaTemporaria tenantId={tenantId} acesso={acesso} />}
      {mensagem && (
        <p role="status" className="text-sm text-ink-soft" data-testid="mensagem-membro">
          {mensagem}
        </p>
      )}

      <Modal
        aberto={pergunta !== null}
        aoFechar={() => !ocupado && setPergunta(null)}
        titulo={pergunta ? TEXTO_PERGUNTA[pergunta].titulo : ""}
        rodape={
          <>
            <Botao variante="secundaria" onClick={() => setPergunta(null)} disabled={ocupado} className="min-h-11">
              Cancelar
            </Botao>
            <Botao
              variante={pergunta && TEXTO_PERGUNTA[pergunta].perigo ? "perigo" : "primaria"}
              onClick={() => void confirmar()}
              disabled={ocupado}
              className="min-h-11"
            >
              {pergunta ? TEXTO_PERGUNTA[pergunta].botao : ""}
            </Botao>
          </>
        }
      >
        {pergunta && <p>{explicacao(pergunta, membro)}</p>}
      </Modal>
    </li>
  );
}
