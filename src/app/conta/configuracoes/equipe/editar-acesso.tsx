"use client";

// "Editar perfil e profissional" de um acesso que já existe: o mesmo
// vínculo, a mesma conta, o mesmo login e a mesma senha. Nada é removido e
// criado de novo, e nenhum agendamento muda de profissional.
//
// A troca de perfil nunca concede permissão sozinha. O que deixa de se aplicar
// sai, o que o dono marcar entra, e a tela mostra o resultado (o que sai e o
// que entra). O dono confirma antes de salvar. Pede a senha do dono (a mesma
// reautenticação das outras mudanças de acesso); o servidor confere tudo de
// novo.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import type { AcessoNaLista, PerfilDaEquipe, PermissaoDaEquipe, VisaoDaEquipe } from "@/lib/equipe/contratos";
import {
  corpoDaEdicao,
  ehAcessoEditado,
  resultadoDaEdicao,
  rotuloDaPermissao,
  type EstadoDoAcesso,
} from "@/lib/equipe/edicao-de-acesso";
import { resumoDasPermissoes } from "@/lib/equipe/permissoes";
import { EditorDePermissoes } from "./editor-de-permissoes";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";
const SEM_PROFISSIONAL = "";
const ROTULO: Record<PerfilDaEquipe, string> = { PROFISSIONAL: "Profissional", GERENTE: "Gerente" };

export function EditarAcesso({
  visao,
  acesso,
  profissionaisLivres,
  aoConcluir,
  aoCancelar,
}: {
  visao: VisaoDaEquipe;
  acesso: AcessoNaLista;
  /** Profissionais ativos sem acesso e sem convite pendente. */
  profissionaisLivres: { id: string; name: string }[];
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const executarSensivel = useAcaoSensivel();
  const atual: EstadoDoAcesso = {
    role: acesso.role === "GERENTE" ? "GERENTE" : "PROFISSIONAL",
    professionalId: acesso.professional?.id ?? null,
    granted: acesso.grantedPermissions,
  };
  const [perfil, setPerfil] = useState<PerfilDaEquipe>(atual.role);
  const [profissionalId, setProfissionalId] = useState(atual.professionalId ?? SEM_PROFISSIONAL);
  const [marcadas, setMarcadas] = useState<PermissaoDaEquipe[]>([...atual.granted]);
  const [conferido, setConferido] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const podeTrocarPerfil = acesso.canChangeRole === true;

  const opcoes = [
    ...(acesso.professional
      ? [
          {
            id: acesso.professional.id,
            name: acesso.professional.name,
            rotulo: `${acesso.professional.name} (atual${acesso.professional.active ? "" : ", desativado"})`,
          },
        ]
      : []),
    ...profissionaisLivres.filter((p) => p.id !== acesso.professional?.id).map((p) => ({ ...p, rotulo: p.name })),
  ];
  const escolha = { perfil, profissionalId: profissionalId || null, marcadas };
  const r = resultadoDaEdicao(atual, escolha);
  const nomeDoProfissional = (id: string | null) =>
    id ? (opcoes.find((p) => p.id === id)?.name ?? "outro profissional") : "nenhum";
  const resumoDepois = resumoDasPermissoes(perfil === "GERENTE" ? (visao.managerPermissions ?? []) : [], visao.permissionLabels, r.valem);

  // Qualquer mudança no formulário pede nova conferência.
  function mudar<T>(set: (v: T) => void) {
    return (valor: T) => {
      set(valor);
      setConferido(false);
      setErro(null);
    };
  }
  const trocarPerfil = mudar((novo: PerfilDaEquipe) => {
    setPerfil(novo);
    if (novo === "PROFISSIONAL" && !profissionalId && opcoes[0]) setProfissionalId(opcoes[0].id);
  });

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado || !r.mudou || r.faltaProfissional || !conferido) return;
    setOcupado(true);
    setErro(null);
    const resposta = await executarSensivel(() =>
      acaoAdministrativa(
        `/tenants/${encodeURIComponent(visao.tenant.id)}/team/members/${encodeURIComponent(acesso.membershipId)}/access`,
        "PUT",
        corpoDaEdicao(atual, escolha),
      ),
    );
    setOcupado(false);
    if (resposta.tipo === "ok" && ehAcessoEditado(resposta.dados)) aoConcluir();
    else if (resposta.tipo === "rede") {
      setErro("Não foi possível confirmar com o servidor. Atualize a lista para ver se a alteração foi salva.");
    } else setErro(resposta.tipo === "ok" ? "Resposta inesperada do servidor." : mensagemDoResultado(resposta));
  }

  return (
    <form
      onSubmit={(e) => void aoEnviar(e)}
      className="space-y-4 rounded-xl border border-border p-3"
      data-testid="editar-acesso"
      aria-label={`Editar perfil e profissional de ${acesso.user.name}`}
    >
      <fieldset disabled={ocupado} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Perfil</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["PROFISSIONAL", "GERENTE"] as const).map((valor) => (
              <label
                key={valor}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-[color:var(--color-accent)]"
              >
                <input
                  type="radio"
                  name={`perfil-${acesso.membershipId}`}
                  className="size-5 shrink-0"
                  checked={perfil === valor}
                  disabled={!podeTrocarPerfil}
                  onChange={() => trocarPerfil(valor)}
                />
                <span className="font-medium text-ink">{ROTULO[valor]}</span>
              </label>
            ))}
          </div>
          {!podeTrocarPerfil && (
            <p className="text-xs text-ink-soft">
              Esta conta também trabalha em outro estabelecimento ou administra a plataforma: o perfil dela não muda por
              aqui. O profissional ligado e as permissões, sim.
            </p>
          )}
        </fieldset>

        <label className="block min-w-0 text-sm font-medium">
          Profissional vinculado
          <select
            className={CAMPO}
            value={profissionalId}
            onChange={(e) => mudar(setProfissionalId)(e.target.value)}
            aria-describedby={`regra-profissional-${acesso.membershipId}`}
          >
            {perfil === "GERENTE" && <option value={SEM_PROFISSIONAL}>Nenhum: não atende clientes</option>}
            {perfil === "PROFISSIONAL" && !profissionalId && <option value={SEM_PROFISSIONAL}>Escolha um profissional</option>}
            {opcoes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </label>
        <p id={`regra-profissional-${acesso.membershipId}`} className="text-xs text-ink-soft">
          {r.faltaProfissional
            ? "O perfil Profissional precisa de um profissional ligado sem outro acesso. Cadastre em Profissionais."
            : "Só aparecem profissionais ativos sem acesso e sem convite pendente. Os agendamentos continuam com o profissional de cada um: nada é transferido."}
        </p>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">Permissões</p>
          <EditorDePermissoes
            visao={visao}
            perfil={perfil}
            comProfissional={!!profissionalId}
            marcadas={r.valem}
            aoMudar={mudar(setMarcadas)}
            prefixo={`editar-${acesso.membershipId}`}
          />
        </div>

        <div
          className="space-y-2 rounded-lg border border-border-strong bg-paper-muted p-3 text-sm"
          data-testid="resultado-da-edicao"
          aria-live="polite"
        >
          <p className="font-semibold text-ink">Confira antes de salvar</p>
          <ul className="list-disc space-y-1 pl-5 text-ink">
            <li>
              Perfil: {ROTULO[perfil]}
              {r.trocaPerfil && ` (era ${ROTULO[atual.role]})`}
            </li>
            <li>
              Profissional: {nomeDoProfissional(profissionalId || null)}
              {!profissionalId && " (não atende clientes)"}
              {r.trocaProfissional && ` (era ${nomeDoProfissional(atual.professionalId)})`}
            </li>
            <li>
              Permissões depois de salvar:{" "}
              {resumoDepois.length ? resumoDepois.join("; ") : "nenhuma além de Perfil e segurança e Aparência"}
            </li>
          </ul>
          {r.saem.length > 0 && (
            <p className="text-ink" data-testid="permissoes-que-saem">
              Saem: {r.saem.map((p) => rotuloDaPermissao(visao, p)).join("; ")}.
            </p>
          )}
          {r.entram.length > 0 && (
            <p className="text-ink" data-testid="permissoes-que-entram">
              Entram (marcadas por você): {r.entram.map((p) => rotuloDaPermissao(visao, p)).join("; ")}.
            </p>
          )}
          <p className="text-xs text-ink-soft">
            A pessoa continua com o mesmo login e a mesma senha. A mudança vale a partir da próxima ação dela, mesmo com o
            aplicativo aberto. Nenhuma permissão entra sem você marcar.
          </p>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5 shrink-0"
              checked={conferido}
              disabled={!r.mudou || r.faltaProfissional}
              onChange={(e) => setConferido(e.target.checked)}
            />
            <span>Conferi o resultado e quero salvar</span>
          </label>
        </div>
      </fieldset>
      {erro && (
        <p role="alert" className="text-sm text-ink" data-testid="erro-editar-acesso">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao
          type="submit"
          className="min-h-11"
          disabled={ocupado || !r.mudou || r.faltaProfissional || !conferido}
          aria-busy={ocupado}
        >
          {ocupado ? "Salvando..." : "Salvar alterações"}
        </Botao>
        <Botao type="button" variante="secundaria" className="min-h-11" onClick={aoCancelar} disabled={ocupado}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
