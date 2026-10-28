"use client";

// "Criar acesso": o dono cadastra uma pessoa da equipe com LOGIN INTERNO e
// SENHA TEMPORÁRIA, sem e-mail, sem convite e sem código. Escolhe o perfil
// (Profissional ou Gerente), o nome, o login, o profissional ligado (o
// gerente pode não ter: não atende clientes) e o que a pessoa pode fazer. A
// senha é gerada pelo servidor e aparece uma vez só (senha-temporaria.tsx).
//
// Pede a senha do dono (a mesma reautenticação das mudanças de acesso). A
// chave do formulário torna o envio idempotente: sem resposta, "Conferir"
// repete o MESMO pedido — se o acesso já tinha sido criado, o servidor
// devolve esse acesso (sem senha) em vez de criar outro.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, mensagemDoResultado, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import {
  LOGIN_MAXIMO,
  ehAcessoCriado,
  erroDoUsuario,
  sugestaoDeUsuario,
  type AcessoCriado,
} from "@/lib/equipe/acesso-por-usuario";
import type { PerfilDaEquipe, PermissaoDaEquipe, VisaoDaEquipe } from "@/lib/equipe/contratos";
import { ajustarAoPerfil } from "@/lib/equipe/permissoes";
import { EditorDePermissoes } from "./editor-de-permissoes";
import { SenhaTemporaria } from "./senha-temporaria";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";
const SEM_PROFISSIONAL = "";

type Fase =
  | { tipo: "editando"; erro: string | null }
  | { tipo: "enviando" }
  | { tipo: "incerto" }
  | { tipo: "criado"; acesso: AcessoCriado };

const PERFIS: { valor: PerfilDaEquipe; rotulo: string; descricao: string }[] = [
  {
    valor: "PROFISSIONAL",
    rotulo: "Profissional",
    descricao: "Atende clientes. Vê a própria agenda; as ações nos próprios atendimentos você libera.",
  },
  {
    valor: "GERENTE",
    rotulo: "Gerente",
    descricao: "Ajuda a cuidar do estabelecimento. Só acessa as áreas que você marcar; pode não atender clientes.",
  },
];

export function CriarAcesso({
  visao,
  profissionaisLivres,
  profissionalInicial,
  aoConcluir,
  aoCancelar,
}: {
  visao: VisaoDaEquipe;
  /** Profissionais ativos sem acesso e sem convite pendente. */
  profissionaisLivres: { id: string; name: string }[];
  profissionalInicial?: string;
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const executarSensivel = useAcaoSensivel();
  const [chave] = useState(novaChaveDeFormulario);
  const [perfil, setPerfil] = useState<PerfilDaEquipe>("PROFISSIONAL");
  const [profissionalId, setProfissionalId] = useState(profissionalInicial ?? profissionaisLivres[0]?.id ?? SEM_PROFISSIONAL);
  const nomeSugerido = (id: string) =>
    (profissionaisLivres.find((p) => p.id === id)?.name ?? "").replace(/^Profissional\s+/i, "");
  const [nome, setNome] = useState(() => nomeSugerido(profissionalInicial ?? profissionaisLivres[0]?.id ?? ""));
  const [usuario, setUsuario] = useState(() => sugestaoDeUsuario(nome));
  const [usuarioEditado, setUsuarioEditado] = useState(false);
  const [marcadas, setMarcadas] = useState<PermissaoDaEquipe[]>([]);
  const [fase, setFase] = useState<Fase>({ tipo: "editando", erro: null });
  const comProfissional = profissionalId !== SEM_PROFISSIONAL;
  const problemaDoUsuario = erroDoUsuario(usuario);
  const faltaProfissional = perfil === "PROFISSIONAL" && !comProfissional;
  const travado = fase.tipo === "enviando" || fase.tipo === "criado";
  const valem = ajustarAoPerfil(marcadas, perfil, comProfissional);

  function trocarPerfil(novo: PerfilDaEquipe) {
    setPerfil(novo);
    if (novo === "PROFISSIONAL" && !comProfissional && profissionaisLivres[0]) setProfissionalId(profissionaisLivres[0].id);
  }

  function trocarNome(valor: string) {
    setNome(valor);
    if (!usuarioEditado) setUsuario(sugestaoDeUsuario(valor));
  }

  async function enviar() {
    setFase({ tipo: "enviando" });
    const r = await executarSensivel(() =>
      acaoAdministrativa(`/tenants/${encodeURIComponent(visao.tenant.id)}/team/staff-accounts`, "POST", {
        requestKey: chave,
        role: perfil,
        professionalId: comProfissional ? profissionalId : null,
        name: nome.trim(),
        username: usuario.trim().toLowerCase(),
        permissions: valem,
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
    if (travado || problemaDoUsuario || faltaProfissional || nome.trim().length < 2) return;
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
            <p className="font-semibold">Este acesso já tinha sido criado (login {acesso.username}).</p>
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
    <section
      aria-labelledby="titulo-criar-acesso"
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-soft)]"
      data-testid="criar-acesso"
    >
      <h2 id="titulo-criar-acesso" className="text-base font-semibold text-ink">
        Criar acesso
      </h2>
      <form onSubmit={aoEnviar} className="space-y-4">
        <fieldset disabled={travado} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">Perfil</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERFIS.map((p) => (
                <label
                  key={p.valor}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-[color:var(--color-accent)]"
                >
                  <input
                    type="radio"
                    name="perfil"
                    className="mt-0.5 size-5 shrink-0"
                    checked={perfil === p.valor}
                    onChange={() => trocarPerfil(p.valor)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{p.rotulo}</span>
                    <span className="block text-xs text-ink-soft">{p.descricao}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-medium">
              Profissional vinculado
              <select
                className={CAMPO}
                value={profissionalId}
                onChange={(e) => {
                  setProfissionalId(e.target.value);
                  if (!nome.trim() && e.target.value) trocarNome(nomeSugerido(e.target.value));
                }}
                aria-describedby="regra-profissional"
              >
                {perfil === "GERENTE" && <option value={SEM_PROFISSIONAL}>Nenhum: não atende clientes</option>}
                {profissionaisLivres.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p id="regra-profissional" className="self-end text-xs text-ink-soft">
              {faltaProfissional
                ? "Todo profissional sem acesso já tem um, ou não há profissional ativo. Cadastre em Profissionais."
                : perfil === "GERENTE"
                  ? "Escolha um profissional só se esta pessoa também atende. Nenhum profissional novo é criado."
                  : "O acesso mostra a agenda deste profissional."}
            </p>
            <label className="min-w-0 text-sm font-medium">
              Nome da pessoa
              <input
                required
                minLength={2}
                maxLength={120}
                className={CAMPO}
                value={nome}
                onChange={(e) => trocarNome(e.target.value)}
              />
            </label>
            <label className="min-w-0 text-sm font-medium">
              Login
              <input
                required
                maxLength={LOGIN_MAXIMO}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className={CAMPO}
                value={usuario}
                onChange={(e) => {
                  setUsuarioEditado(true);
                  setUsuario(e.target.value);
                }}
                aria-describedby="regra-usuario"
              />
            </label>
            <p id="regra-usuario" className="text-xs text-ink-soft sm:col-span-2">
              {problemaDoUsuario ??
                "É com ele que a pessoa entra. Não precisa ser um e-mail real, mesmo com @ (como maria@salao): nada é enviado para ele. Único na plataforma."}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-ink">Permissões</p>
            <EditorDePermissoes
              visao={visao}
              perfil={perfil}
              comProfissional={comProfissional}
              marcadas={valem}
              aoMudar={setMarcadas}
              prefixo="novo"
            />
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
            <Botao
              type="submit"
              className="min-h-11"
              disabled={travado || !!problemaDoUsuario || faltaProfissional}
              aria-busy={fase.tipo === "enviando"}
            >
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
        dela no primeiro acesso. Se ela esquecer a senha, você gera outra aqui. Ocupa uma vaga de equipe do plano.
      </p>
    </section>
  );
}
