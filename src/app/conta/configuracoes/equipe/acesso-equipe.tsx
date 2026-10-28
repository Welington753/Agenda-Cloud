"use client";

// Um acesso de equipe (profissional ou gerente): perfil, situação,
// profissional ligado e as permissões que VALEM agora. As ações aparecem
// conforme a situação; o servidor confere cada uma de novo (vaga,
// profissional ativo, conta bloqueada, permissões que o dono pode dar).
//
// Suspender, reativar, remover, mudar permissões e gerar nova senha pedem a
// senha do dono (useAcaoSensivel, a mesma reautenticação da administração).
import { useState } from "react";
import {
  AlertTriangle,
  CircleCheck,
  CirclePause,
  CircleSlash,
  Crown,
  History,
  type LucideIcon,
} from "lucide-react";
import { Badge, type CorBadge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, mensagemDoResultado, type ResultadoAcao } from "@/lib/administracao/api-contas";
import {
  ROTULO_PERFIL,
  ROTULO_SITUACAO,
  type AcessoNaLista,
  type PerfilDaEquipe,
  type PermissaoDaEquipe,
  type SituacaoNaEquipe,
  type VisaoDaEquipe,
} from "@/lib/equipe/contratos";
import { mesmasPermissoes, resumoDasPermissoes } from "@/lib/equipe/permissoes";
import { EditorDePermissoes } from "./editor-de-permissoes";
import { NovaSenhaTemporaria } from "./nova-senha-temporaria";

export const ESTILO_SITUACAO: Record<SituacaoNaEquipe, { cor: CorBadge; icone: LucideIcon }> = {
  OWNER: { cor: "destaque", icone: Crown },
  ACTIVE: { cor: "sucesso", icone: CircleCheck },
  SUSPENDED: { cor: "aviso", icone: CirclePause },
  PROFESSIONAL_INACTIVE: { cor: "neutro", icone: CircleSlash },
  PERMISSIONS_PENDING: { cor: "aviso", icone: AlertTriangle },
  LEGACY_ROLE: { cor: "neutro", icone: History },
  INVITED: { cor: "info", icone: History },
  NO_ACCESS: { cor: "neutro", icone: CircleSlash },
};

export function SituacaoDoAcesso({ situacao }: { situacao: SituacaoNaEquipe }) {
  const { cor, icone: Icone } = ESTILO_SITUACAO[situacao];
  return (
    <Badge cor={cor} data-testid="situacao-acesso">
      <Icone size={14} aria-hidden="true" />
      {ROTULO_SITUACAO[situacao]}
    </Badge>
  );
}

type Pergunta = "suspender" | "reativar" | "remover";

const TEXTO_PERGUNTA: Record<Pergunta, { titulo: string; botao: string; perigo?: boolean }> = {
  suspender: { titulo: "Suspender o acesso?", botao: "Suspender acesso" },
  reativar: { titulo: "Reativar o acesso?", botao: "Reativar acesso" },
  remover: { titulo: "Remover o acesso?", botao: "Remover acesso", perigo: true },
};

function explicacao(pergunta: Pergunta, acesso: AcessoNaLista): string {
  const pessoa = acesso.user.name;
  switch (pergunta) {
    case "suspender":
      return `${pessoa} deixa de acessar este estabelecimento já na próxima ação, mesmo com o aplicativo aberto. A conta, a senha e o acesso a outros estabelecimentos continuam. A vaga do plano fica livre; reativar depois depende de haver vaga.`;
    case "reativar":
      return `${pessoa} volta a acessar este estabelecimento com as permissões que tinha. Ocupa de novo uma vaga do plano.`;
    case "remover":
      return `O vínculo de ${pessoa} com este estabelecimento é apagado, com as permissões dele. A conta da pessoa, o acesso a outros estabelecimentos, o cadastro do profissional e as reservas continuam. Para dar acesso de novo, crie outro acesso.`;
  }
}

export function AcessoEquipe({ acesso, visao, aoMudar }: { acesso: AcessoNaLista; visao: VisaoDaEquipe; aoMudar: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { notificar } = useToast();
  const [pergunta, setPergunta] = useState<Pergunta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [editando, setEditando] = useState(false);
  const [marcadas, setMarcadas] = useState<PermissaoDaEquipe[]>(acesso.grantedPermissions);
  const base = `/tenants/${encodeURIComponent(visao.tenant.id)}/team`;
  const deEquipe = acesso.role === "PROFISSIONAL" || acesso.role === "GERENTE";
  const perfil = (acesso.role === "GERENTE" ? "GERENTE" : "PROFISSIONAL") as PerfilDaEquipe;
  const comProfissional = !!acesso.professional;
  const mudou = !mesmasPermissoes(marcadas, acesso.grantedPermissions);
  const efetivas = resumoDasPermissoes(
    perfil === "GERENTE" ? (visao.managerPermissions ?? []) : [],
    visao.permissionLabels,
    acesso.grantedPermissions,
  );
  const login = acesso.user.hasEmail === false ? `login ${acesso.user.email}` : acesso.user.email;

  function responder(r: ResultadoAcao<unknown>, sucesso: string) {
    if (r.tipo === "ok") {
      setMensagem("");
      notificar(sucesso, "sucesso");
      aoMudar();
    } else setMensagem(mensagemDoResultado(r));
  }

  async function confirmar() {
    if (!pergunta || ocupado) return;
    setOcupado(true);
    const id = encodeURIComponent(acesso.membershipId);
    const chamadas: Record<Pergunta, [() => Promise<ResultadoAcao<unknown>>, string]> = {
      suspender: [() => acaoAdministrativa(`${base}/members/${id}/suspend`, "POST"), "Acesso suspenso."],
      reativar: [() => acaoAdministrativa(`${base}/members/${id}/reactivate`, "POST"), "Acesso reativado."],
      remover: [() => acaoAdministrativa(`${base}/members/${id}`, "DELETE"), "Acesso removido."],
    };
    const [chamada, sucesso] = chamadas[pergunta];
    const r = await executarSensivel(chamada);
    setOcupado(false);
    setPergunta(null);
    responder(r, sucesso);
  }

  async function salvarPermissoes() {
    if (ocupado) return;
    setOcupado(true);
    const r = await executarSensivel(() =>
      acaoAdministrativa(`${base}/members/${encodeURIComponent(acesso.membershipId)}/permissions`, "PUT", {
        expectedGranted: acesso.grantedPermissions,
        granted: marcadas,
      }),
    );
    setOcupado(false);
    if (r.tipo === "ok") setEditando(false);
    responder(r, "Permissões salvas. Valem a partir da próxima ação da pessoa.");
  }

  return (
    <li
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-soft)]"
      data-testid="acesso-equipe"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold text-ink">{acesso.user.name}</p>
          <p className="break-all text-sm text-ink-soft" data-testid="identificacao-acesso">
            {login}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge cor="neutro" data-testid="perfil-acesso">
            {ROTULO_PERFIL[acesso.role] ?? acesso.role}
          </Badge>
          <SituacaoDoAcesso situacao={acesso.situation} />
          {acesso.user.status === "SUSPENDED" && (
            <Badge cor="erro">
              <CircleSlash size={14} aria-hidden="true" />
              Conta bloqueada pela plataforma
            </Badge>
          )}
        </div>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">Profissional vinculado</dt>
          <dd className="text-ink" data-testid="profissional-vinculado">
            {acesso.professional
              ? `${acesso.professional.name}${acesso.professional.active ? "" : " (desativado)"}`
              : "Nenhum: não atende clientes"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-soft">Permissões que valem agora</dt>
          <dd className="text-ink" data-testid="permissoes-efetivas">
            {acesso.situation === "PERMISSIONS_PENDING" ? (
              "Nenhuma até você confirmar as permissões abaixo."
            ) : acesso.situation === "LEGACY_ROLE" ? (
              "Nenhuma: papel antigo sem área."
            ) : efetivas.length === 0 ? (
              comProfissional ? "Ver a própria agenda." : "Nenhuma área do estabelecimento."
            ) : (
              <ul className="list-disc space-y-0.5 pl-5">
                {comProfissional && <li>Ver a própria agenda</li>}
                {efetivas.map((linha) => (
                  <li key={linha}>{linha}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      {acesso.situation === "PERMISSIONS_PENDING" && (
        <p className="text-xs text-ink-soft" data-testid="aviso-gerente-antigo">
          Acesso de gerente anterior à tela de permissões: por segurança, nada foi liberado automaticamente. Marque o que
          esta pessoa pode fazer e salve para confirmar.
        </p>
      )}
      {acesso.professional && !acesso.professional.active && acesso.professional.futureAppointments > 0 && (
        <p className="text-xs text-ink-soft">
          {acesso.professional.futureAppointments} reserva(s) futura(s) do profissional desativado continua(m) na agenda e
          precisam de tratamento.
        </p>
      )}

      {deEquipe && (editando || acesso.situation === "PERMISSIONS_PENDING") && (
        <fieldset className="space-y-3" disabled={ocupado}>
          <legend className="sr-only">Permissões de {acesso.user.name}</legend>
          <EditorDePermissoes
            visao={visao}
            perfil={perfil}
            comProfissional={comProfissional}
            marcadas={marcadas}
            aoMudar={setMarcadas}
            prefixo={acesso.membershipId}
          />
          <div className="flex flex-wrap gap-2">
            <Botao
              type="button"
              className="min-h-11"
              disabled={!mudou && acesso.situation !== "PERMISSIONS_PENDING"}
              onClick={() => void salvarPermissoes()}
            >
              {acesso.situation === "PERMISSIONS_PENDING" ? "Confirmar permissões" : "Salvar permissões"}
            </Botao>
            {editando && (
              <Botao
                type="button"
                variante="fantasma"
                className="min-h-11"
                onClick={() => {
                  setMarcadas(acesso.grantedPermissions);
                  setEditando(false);
                }}
              >
                Cancelar
              </Botao>
            )}
          </div>
        </fieldset>
      )}

      {deEquipe && (
        <div className="flex flex-wrap gap-2">
          {!editando && acesso.situation !== "PERMISSIONS_PENDING" && (
            <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setEditando(true)}>
              Editar permissões
            </Botao>
          )}
          {acesso.status === "ACTIVE" ? (
            <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setPergunta("suspender")}>
              Suspender acesso
            </Botao>
          ) : (
            <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setPergunta("reativar")}>
              Reativar acesso
            </Botao>
          )}
          <Botao type="button" variante="fantasma" className="min-h-11" onClick={() => setPergunta("remover")}>
            Remover acesso
          </Botao>
        </div>
      )}
      {acesso.canResetTemporaryPassword ? (
        <NovaSenhaTemporaria tenantId={visao.tenant.id} acesso={acesso} />
      ) : (
        deEquipe && (
          <p className="text-xs text-ink-soft">
            Esta conta entra por e-mail ou também trabalha em outro lugar: a senha dela não é só deste estabelecimento. A
            recuperação é pela administração da plataforma.
          </p>
        )
      )}
      {mensagem && (
        <p role="status" className="text-sm text-ink-soft" data-testid="mensagem-acesso">
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
        {pergunta && <p>{explicacao(pergunta, acesso)}</p>}
      </Modal>
    </li>
  );
}
