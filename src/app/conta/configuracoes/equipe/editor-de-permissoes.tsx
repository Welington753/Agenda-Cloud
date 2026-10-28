"use client";

// Escolha do que um acesso de equipe pode fazer, por área e ação, com o
// resumo exato do que será concedido. Mostra só o que tem efeito no servidor
// (o catálogo vem dele) e distingue a agenda PRÓPRIA (profissional ligado) da
// agenda do ESTABELECIMENTO (todos os profissionais).
//
// Marcar uma área traz as dependências dela; uma área exigida por outra
// marcada não sai sozinha (a tela diz qual a exige). O dono só marca o que
// ele mesmo pode fazer; o servidor confere tudo de novo.
import type {
  PerfilDaEquipe,
  PermissaoDaEquipe,
  PermissaoFuncionario,
  VisaoDaEquipe,
} from "@/lib/equipe/contratos";
import { alternarArea, areasDoCatalogo, exigidaPor, resumoDasPermissoes } from "@/lib/equipe/permissoes";

export function EditorDePermissoes({
  visao,
  perfil,
  comProfissional,
  marcadas,
  aoMudar,
  prefixo,
}: {
  visao: VisaoDaEquipe;
  perfil: PerfilDaEquipe;
  comProfissional: boolean;
  marcadas: readonly PermissaoDaEquipe[];
  aoMudar: (novas: PermissaoDaEquipe[]) => void;
  /** Distingue os ids quando há vários editores na página. */
  prefixo: string;
}) {
  const catalogo = visao.managerPermissions ?? [];
  const podeConcederPropria = (p: PermissaoFuncionario) => visao.grantablePermissions.some((g) => g.permission === p);
  const resumo = resumoDasPermissoes(perfil === "GERENTE" ? catalogo : [], visao.permissionLabels, marcadas);

  return (
    <div className="space-y-4" data-testid="editor-permissoes">
      <p className="text-xs text-ink-soft">
        Sempre, para qualquer acesso: Perfil e segurança e Aparência.
        {comProfissional ? " Com profissional ligado: a própria agenda (data, horário, cliente, serviço e situação)." : ""}
      </p>

      {comProfissional && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold text-ink">Própria agenda</legend>
          <p className="text-xs text-ink-soft">Só os atendimentos do profissional ligado a este acesso.</p>
          {visao.permissionLabels.map(({ permission, label }) => {
            const marcada = marcadas.includes(permission);
            const bloqueada = !marcada && !podeConcederPropria(permission);
            return (
              <label key={permission} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={marcada}
                  disabled={bloqueada}
                  onChange={(e) =>
                    aoMudar(e.target.checked ? [...marcadas, permission] : marcadas.filter((p) => p !== permission))
                  }
                />
                <span>
                  {label}
                  {bloqueada && <span className="block text-xs text-ink-soft">Você não pode liberar o que não pode fazer.</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {perfil === "GERENTE" &&
        areasDoCatalogo(catalogo).map((grupo) => (
          <fieldset key={grupo.area} className="space-y-1" data-testid={`area-${grupo.area}`}>
            <legend className="text-sm font-semibold text-ink">{grupo.rotulo}</legend>
            {grupo.area === "AGENDA" && (
              <p className="text-xs text-ink-soft">Todos os profissionais do estabelecimento, não só a própria agenda.</p>
            )}
            {grupo.itens.map((item) => {
              const marcada = marcadas.includes(item.permission);
              const quemExige = marcada ? exigidaPor(catalogo, marcadas, item.permission) : [];
              const bloqueada = (!marcada && !item.grantable) || quemExige.length > 0;
              const idDetalhe = `${prefixo}-${item.permission}-detalhe`;
              const inclui = item.requires
                .map((r) => catalogo.find((c) => c.permission === r)?.label.toLowerCase())
                .filter(Boolean);
              return (
                <div key={item.permission} className="py-1">
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0"
                      checked={marcada}
                      disabled={bloqueada}
                      aria-describedby={idDetalhe}
                      onChange={(e) => aoMudar(alternarArea(catalogo, marcadas, item.permission, e.target.checked))}
                    />
                    <span className="min-w-0">{item.label}</span>
                  </label>
                  {/* Fora do rótulo: o nome do campo é só a ação; a explicação
                      vem ligada por aria-describedby. */}
                  <p id={idDetalhe} className="-mt-2 pl-8 text-xs text-ink-soft">
                    {item.detail}
                    {inclui.length > 0 && ` Inclui: ${inclui.join("; ")}.`}
                    {!marcada && !item.grantable && " Você não pode liberar o que não pode fazer."}
                    {quemExige.length > 0 && ` Necessária para: ${quemExige.map((c) => c.label.toLowerCase()).join("; ")}.`}
                  </p>
                </div>
              );
            })}
          </fieldset>
        ))}

      <div className="rounded-lg border border-border bg-paper-muted p-3 text-sm" data-testid="resumo-permissoes" aria-live="polite">
        <p className="font-semibold text-ink">O que será concedido</p>
        {resumo.length === 0 ? (
          <p className="mt-1 text-ink-soft">
            {comProfissional ? "Só ver a própria agenda" : "Nenhuma área do estabelecimento"}, além de Perfil e segurança e
            Aparência.
          </p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink">
            {resumo.map((linha) => (
              <li key={linha}>{linha}</li>
            ))}
          </ul>
        )}
        {perfil === "GERENTE" && (
          <p className="mt-2 text-xs text-ink-soft">
            Gerente não administra a equipe, as permissões, as senhas de outras pessoas, as configurações do
            estabelecimento nem a administração da plataforma.
          </p>
        )}
      </div>
    </div>
  );
}
