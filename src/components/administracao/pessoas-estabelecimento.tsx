"use client";

// Quem tem acesso a um estabelecimento (vínculos reais, com o acesso efetivo
// calculado pelo servidor), os convites pendentes e o convite de um novo
// responsável. Abrir esta ficha não cria vínculo nem troca o estabelecimento
// ativo de quem administra.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoLeitura } from "./estado-leitura";
import { ResultadoEnvio } from "./resultado-envio";
import { SituacaoDoConvite } from "./estado-envio";
import { AcoesConvite } from "./acoes-convite";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { useEnvioComChave } from "@/lib/administracao/use-envio-com-chave";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { ehMembros, ehResultadoCriacao } from "@/lib/administracao/contas";
import { PAPEIS_ESTABELECIMENTO, SITUACOES_CONTA, corConta } from "@/lib/administracao/rotulos";
import { rotaFichaUsuario } from "@/lib/administracao/rotas";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm";

function ConvidarResponsavel({ tenantId, aoConvidar }: { tenantId: string; aoConvidar: () => void }) {
  const envio = useEnvioComChave(ehResultadoCriacao);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    void envio
      .enviar((requestKey) =>
        acaoAdministrativa(`/platform/establishments/${encodeURIComponent(tenantId)}/invites`, "POST", {
          requestKey,
          name: nome,
          email,
          role: "DONO",
        }),
      )
      .then(aoConvidar);
  }
  const travado = envio.estado.fase === "enviando" || envio.estado.fase === "incerto";
  return (
    <div className="space-y-3">
      <form onSubmit={aoEnviar} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <fieldset disabled={travado || envio.estado.fase === "ok"} className="contents">
          <label className="min-w-0 text-sm font-medium">
            Nome
            <input required minLength={2} maxLength={120} className={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label className="min-w-0 text-sm font-medium">
            E-mail
            <input required type="email" maxLength={254} className={CAMPO} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <Botao type="submit" className="min-h-11">
            Convidar como dono(a)
          </Botao>
        </fieldset>
      </form>
      <p className="text-xs text-ink-soft">
        A administração convida donos. Funcionários são convidados pelo dono, em Equipe e acessos, ligados a um
        profissional e limitados pelo plano.
      </p>
      <ResultadoEnvio
        estado={envio.estado}
        aoConsultar={() => void envio.consultar()}
        aoRepetir={() => envio.recomecar()}
        sucesso={(dados) => (
          <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">{dados.created ? "Convite registrado." : "Este convite já tinha sido criado."}</p>
            <SituacaoDoConvite convite={dados.invite} detalhar />
            <Botao
              variante="secundaria"
              className="min-h-11"
              onClick={() => {
                setNome("");
                setEmail("");
                envio.recomecar();
              }}
            >
              Convidar outra pessoa
            </Botao>
          </div>
        )}
      />
    </div>
  );
}

export function PessoasEstabelecimento({ tenantId }: { tenantId: string }) {
  const { estado, recarregar, anterior } = useLeituraPlataforma(
    `/platform/establishments/${encodeURIComponent(tenantId)}/members`,
    ehMembros,
  );
  // Enquanto relê (depois de um convite), mostra os dados anteriores: o
  // formulário e o resultado do convite continuam na tela.
  const dados = estado.status === "pronto" ? estado.dados : anterior;
  return (
    <Cartao>
      <CartaoCorpo className="space-y-5">
        <h2 className="font-semibold">Pessoas com acesso</h2>
        {!dados ? (
          estado.status !== "pronto" && <EstadoLeitura estado={estado} recarregar={recarregar} />
        ) : (
          <>
            {dados.members.length === 0 ? (
              <p className="text-sm text-ink-soft">Ninguém tem vínculo com este estabelecimento ainda.</p>
            ) : (
              <ul className="space-y-3" data-testid="pessoas-estabelecimento">
                {dados.members.map((m) => {
                  const liberadas = m.effectiveAccess.filter((a) => a.allowed).length;
                  return (
                    <li key={m.id} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={rotaFichaUsuario(m.user.id)} className="min-h-11 break-all font-semibold text-accent hover:underline">
                          {m.user.name}
                        </Link>
                        <div className="flex flex-wrap gap-2">
                          <Badge cor="destaque">{PAPEIS_ESTABELECIMENTO[m.role] ?? m.role}</Badge>
                          {m.status === "SUSPENDED" && <Badge cor="aviso">Acesso suspenso</Badge>}
                          <Badge cor={corConta(m.user.status)}>{SITUACOES_CONTA[m.user.status as never] ?? m.user.status}</Badge>
                        </div>
                      </div>
                      <p className="break-all text-ink-soft">{m.user.email}</p>
                      <p className="mt-1 text-xs text-ink-soft">
                        {m.role === "PROFISSIONAL"
                          ? `Funcionário(a)${m.professional ? ` ligado(a) a ${m.professional.name}` : ""}: vê a própria agenda${liberadas > 1 ? ` e faz ${liberadas - 1} ação(ões) liberada(s) pelo dono` : ""}.`
                          : m.roleHasAccess
                            ? `${liberadas} de ${m.effectiveAccess.length} áreas liberadas${m.deniedPermissions.length ? `, ${m.deniedPermissions.length} restrição(ões)` : ""}.`
                            : "Este papel não libera nenhuma área hoje."}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {dados.pendingInvites.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Convites pendentes</h3>
                {dados.pendingInvites.map((convite) => (
                  <div key={convite.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                    <p className="break-all">
                      <span className="font-medium">{convite.targetName}</span> · {convite.targetEmail}
                    </p>
                    <SituacaoDoConvite convite={convite} detalhar />
                    {dados.canInvite && <AcoesConvite convite={convite} aoMudar={recarregar} />}
                  </div>
                ))}
              </div>
            )}
            {dados.canInvite && (
              <div className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold">Convidar responsável</h3>
                <ConvidarResponsavel tenantId={tenantId} aoConvidar={recarregar} />
              </div>
            )}
          </>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
