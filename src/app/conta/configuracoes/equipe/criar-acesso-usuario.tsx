"use client";

// Acesso de funcionário com NOME DE USUÁRIO e SENHA TEMPORÁRIA, sem e-mail.
// O dono escolhe o nome da pessoa, o usuário e o que ela pode fazer; a senha
// é gerada pelo servidor e aparece uma vez só (ver senha-temporaria.tsx).
//
// Pede a senha do dono (a mesma reautenticação das mudanças de acesso). A
// chave do formulário torna o envio idempotente: sem resposta, "Conferir"
// repete o MESMO pedido — se o acesso já tinha sido criado, o servidor
// devolve esse acesso (sem senha) em vez de criar outro.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, mensagemDoResultado, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import { sugestaoDeUsuario, erroDoUsuario, ehAcessoCriado, type AcessoCriado } from "@/lib/equipe/acesso-por-usuario";
import type { PermissaoFuncionario, VisaoDaEquipe } from "@/lib/equipe/contratos";
import { SenhaTemporaria } from "./senha-temporaria";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

type Fase =
  | { tipo: "editando"; erro: string | null }
  | { tipo: "enviando" }
  | { tipo: "incerto" }
  | { tipo: "criado"; acesso: AcessoCriado };

export function CriarAcessoUsuario({
  visao,
  professional,
  aoConcluir,
  aoCancelar,
}: {
  visao: VisaoDaEquipe;
  professional: { id: string; name: string };
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const executarSensivel = useAcaoSensivel();
  const nomeInicial = professional.name.replace(/^Profissional\s+/i, "");
  const [chave] = useState(novaChaveDeFormulario);
  const [nome, setNome] = useState(nomeInicial);
  const [usuario, setUsuario] = useState(() => sugestaoDeUsuario(nomeInicial));
  const [marcadas, setMarcadas] = useState<PermissaoFuncionario[]>([]);
  const [fase, setFase] = useState<Fase>({ tipo: "editando", erro: null });
  const problemaDoUsuario = erroDoUsuario(usuario);
  const travado = fase.tipo === "enviando" || fase.tipo === "criado";

  async function enviar() {
    setFase({ tipo: "enviando" });
    const r = await executarSensivel(() =>
      acaoAdministrativa(`/tenants/${encodeURIComponent(visao.tenant.id)}/team/staff-accounts`, "POST", {
        requestKey: chave,
        professionalId: professional.id,
        name: nome.trim(),
        username: usuario.trim().toLowerCase(),
        permissions: marcadas,
      }),
    );
    if (r.tipo === "ok") {
      if (ehAcessoCriado(r.dados)) setFase({ tipo: "criado", acesso: r.dados });
      else setFase({ tipo: "editando", erro: "Resposta inesperada do servidor. Atualize a lista antes de repetir." });
    } else if (r.tipo === "rede") {
      setFase({ tipo: "incerto" });
    } else {
      setFase({ tipo: "editando", erro: mensagemDoResultado(r) });
    }
  }

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (travado || problemaDoUsuario || nome.trim().length < 2) return;
    void enviar();
  }

  if (fase.tipo === "criado") {
    const { acesso } = fase;
    return (
      <div className="space-y-3" data-testid="acesso-criado">
        {acesso.temporaryPassword ? (
          <SenhaTemporaria usuario={acesso.username} senha={acesso.temporaryPassword} aoFechar={aoConcluir} />
        ) : (
          <div role="status" className="space-y-2 rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">Este acesso já tinha sido criado (usuário {acesso.username}).</p>
            <p className="text-ink-soft">
              A senha temporária só aparece na criação. Se ela se perdeu, use “Gerar nova senha temporária”.
            </p>
            <Botao type="button" variante="secundaria" className="min-h-11" onClick={aoConcluir}>
              Concluir
            </Botao>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3" data-testid="criar-acesso-usuario">
      <form onSubmit={aoEnviar} className="space-y-3">
        <fieldset disabled={travado} className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-medium">
            Nome da pessoa
            <input required minLength={2} maxLength={120} className={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label className="min-w-0 text-sm font-medium">
            Nome de usuário
            <input
              required
              maxLength={40}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={CAMPO}
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              aria-describedby="regra-usuario"
            />
          </label>
          <p id="regra-usuario" className="text-xs text-ink-soft sm:col-span-2">
            {problemaDoUsuario ??
              "É com ele que a pessoa entra. Único na plataforma: se já estiver em uso, escolha outro (por exemplo, com o nome do estabelecimento)."}
          </p>
          <div className="space-y-1 sm:col-span-2">
            <p className="text-sm font-medium">O que a pessoa pode fazer</p>
            <p className="text-xs text-ink-soft">Sempre: ver a própria agenda.</p>
            {visao.grantablePermissions.map(({ permission, label }) => (
              <label key={permission} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={marcadas.includes(permission)}
                  onChange={(e) =>
                    setMarcadas((atual) => (e.target.checked ? [...atual, permission] : atual.filter((p) => p !== permission)))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {fase.tipo === "editando" && fase.erro && (
          <p role="alert" className="text-sm text-ink" data-testid="erro-criar-acesso">
            {fase.erro}
          </p>
        )}
        {fase.tipo === "incerto" ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>Não foi possível confirmar com o servidor. O acesso pode ter sido criado.</p>
            <Botao type="button" className="min-h-11" onClick={() => void enviar()}>
              Conferir
            </Botao>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Botao type="submit" className="min-h-11" disabled={travado || !!problemaDoUsuario} aria-busy={fase.tipo === "enviando"}>
              {fase.tipo === "enviando" ? "Criando..." : "Criar acesso"}
            </Botao>
            <Botao type="button" variante="fantasma" className="min-h-11" onClick={aoCancelar} disabled={fase.tipo === "enviando"}>
              Cancelar
            </Botao>
          </div>
        )}
      </form>
      <p className="text-xs text-ink-soft">
        Sem e-mail e sem convite: o servidor gera uma senha temporária, que aparece só uma vez. A pessoa troca por uma
        dela no primeiro acesso. Ocupa uma vaga do plano.
      </p>
    </div>
  );
}
