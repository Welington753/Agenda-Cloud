"use client";

// Nova empresa com o responsável. O servidor cria estabelecimento (em teste),
// unidade principal, a versão 1 da assinatura modular (Agendamento essencial +
// adicionais, valor mensal e limite de usuários da equipe) e o convite de
// DONO numa transação só. O limite é obrigatório e explícito. E-mail sem conta
// gera uma conta PENDENTE, que só entra depois de ativar pelo link; e-mail
// com conta recebe um convite de vínculo e nada da pessoa muda. Escolher
// assinatura NÃO registra pagamento.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { LinkBotao, Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { ResultadoEnvio } from "@/components/administracao/resultado-envio";
import { SituacaoDoConvite } from "@/components/administracao/estado-envio";
import {
  CampoLimite,
  CampoValorNegociado,
  EscolhaDeAdicionais,
  EssencialIncluido,
  ResumoDaAssinatura,
} from "@/components/administracao/assinatura-modular";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { useEnvioComChave } from "@/lib/administracao/use-envio-com-chave";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { ehResultadoCriacao } from "@/lib/administracao/contas";
import { SEGMENTOS } from "@/lib/administracao/contratos";
import { calcularEscolha, ehCatalogoAssinatura, revisarAssinatura, validarLimite } from "@/lib/administracao/assinatura";
import { centavosDe } from "@/lib/administracao/validade";
import { ROTA_ESTABELECIMENTOS_ADMINISTRADOS, rotaFichaEstabelecimento } from "@/lib/administracao/rotas";
import { useCapacidades } from "@/lib/administracao/use-acesso-plataforma";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export default function NovoEstabelecimentoPage() {
  const capacidades = useCapacidades();
  const catalogo = useLeituraPlataforma("/platform/addons", ehCatalogoAssinatura);
  const envio = useEnvioComChave(ehResultadoCriacao);
  const vazio = { businessName: "", category: "OTHER", limite: "", valor: "", motivo: "", name: "", email: "", phone: "" };
  const [form, setForm] = useState(vazio);
  const [adicionais, setAdicionais] = useState<string[]>([]);
  const [ajustando, setAjustando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const campo = (nome: keyof typeof form) => ({
    value: form[nome],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [nome]: e.target.value })),
  });

  if (!capacidades.manageEstablishments)
    return (
      <p role="alert" className="rounded-xl border border-border bg-card p-6">
        Sua conta pode consultar, mas não criar estabelecimentos.
      </p>
    );
  if (catalogo.estado.status !== "pronto") return <EstadoLeitura estado={catalogo.estado} recarregar={catalogo.recarregar} />;
  const dados = catalogo.estado.dados;

  const centavos = ajustando && form.valor.trim() ? centavosDe(form.valor) : null;
  const valorInvalido = ajustando && form.valor.trim() !== "" && centavos === null;
  const escolha = calcularEscolha(dados.basePriceCents, dados.addons, adicionais, { centavos, motivo: form.motivo });
  const limite = validarLimite(form.limite, null);
  const mostrarErroDoLimite = form.limite.trim() !== "";
  const revisao = revisarAssinatura({
    atual: null,
    ligadosHoje: [],
    adicionais: dados.addons,
    escolha,
    limite: limite.valor ?? 0,
    limiteAtual: null,
    conversao: null,
  });
  const pronto = !valorInvalido && limite.valor !== null && escolha.pendencias.length === 0;

  function alternar(code: string) {
    setAdicionais((atual) => (atual.includes(code) ? atual.filter((c) => c !== code) : [...atual, code]));
  }

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (pronto) setRevisando(true);
  }

  function criar() {
    setRevisando(false);
    void envio.enviar((requestKey) =>
      acaoAdministrativa("/platform/establishments", "POST", {
        requestKey,
        businessName: form.businessName,
        category: form.category,
        addons: escolha.itens.map((i) => i.code),
        teamUserLimit: limite.valor,
        ...(escolha.negociado ? { contractedTotalCents: escolha.totalContratadoCents, reason: form.motivo.trim() } : {}),
        owner: { name: form.name, email: form.email, ...(form.phone.trim() ? { phone: form.phone } : {}) },
      }),
    );
  }

  const bloqueado = envio.estado.fase === "enviando" || envio.estado.fase === "ok" || envio.estado.fase === "incerto";

  return (
    <div className="space-y-6">
      <header>
        <Link href={ROTA_ESTABELECIMENTOS_ADMINISTRADOS} className="inline-flex min-h-11 items-center text-sm font-medium text-accent">
          ← Estabelecimentos
        </Link>
        <h1 className="text-2xl font-bold">Novo estabelecimento</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Cria a empresa em período de teste, com a assinatura escolhida, e convida o responsável por e-mail. A pessoa
          define a própria senha ao ativar. Nenhuma senha é enviada nem definida aqui.
        </p>
      </header>
      <form onSubmit={aoEnviar}>
        <fieldset disabled={bloqueado} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="min-w-0 space-y-6">
            <Cartao>
              <CartaoCorpo className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium sm:col-span-2">
                  Nome do estabelecimento
                  <input required minLength={2} maxLength={120} className={CAMPO} {...campo("businessName")} />
                </label>
                <label className="text-sm font-medium">
                  Segmento
                  <select className={CAMPO} {...campo("category")}>
                    {Object.entries(SEGMENTOS).map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>
                        {rotulo}
                      </option>
                    ))}
                  </select>
                </label>
                <CampoLimite
                  valor={form.limite}
                  aoMudar={(v) => setForm((f) => ({ ...f, limite: v }))}
                  erro={mostrarErroDoLimite ? limite.erro : null}
                />
              </CartaoCorpo>
            </Cartao>
            <EssencialIncluido basePriceCents={dados.basePriceCents} />
            <EscolhaDeAdicionais adicionais={dados.addons} selecionados={adicionais} aoAlternar={alternar} />
            <Cartao>
              <CartaoCorpo className="grid gap-4 sm:grid-cols-2">
                <h2 className="font-semibold sm:col-span-2">Responsável</h2>
                <label className="text-sm font-medium">
                  Nome
                  <input required minLength={2} maxLength={120} className={CAMPO} {...campo("name")} />
                </label>
                <label className="text-sm font-medium">
                  E-mail
                  <input required type="email" maxLength={254} className={CAMPO} {...campo("email")} />
                </label>
                <label className="text-sm font-medium">
                  Telefone (opcional)
                  <input inputMode="tel" maxLength={20} className={CAMPO} {...campo("phone")} />
                </label>
              </CartaoCorpo>
            </Cartao>
          </div>
          <div className="min-w-0 space-y-4">
            <ResumoDaAssinatura nome={form.businessName} basePriceCents={dados.basePriceCents} escolha={escolha} limite={form.limite}>
              {ajustando && (
                <CampoValorNegociado
                  valor={form.valor}
                  motivo={form.motivo}
                  aoMudarValor={(v) => setForm((f) => ({ ...f, valor: v }))}
                  aoMudarMotivo={(v) => setForm((f) => ({ ...f, motivo: v }))}
                  invalido={valorInvalido}
                />
              )}
              {escolha.pendencias.map((p) => (
                <p key={p} className="text-xs text-[color:var(--color-danger)]">
                  {p}
                </p>
              ))}
              <Botao
                type="button"
                variante="secundaria"
                className="min-h-11 w-full"
                onClick={() => {
                  setAjustando((a) => !a);
                  setForm((f) => ({ ...f, valor: "", motivo: "" }));
                }}
              >
                {ajustando ? "Seguir o total do catálogo" : "Ajustar valor contratado"}
              </Botao>
              <Botao type="submit" className="min-h-11 w-full" disabled={!pronto}>
                Revisar e criar
              </Botao>
              <p className="text-xs text-ink-soft">
                Escolher a assinatura não registra pagamento. O estabelecimento começa no teste gratuito; o pagamento é
                registrado depois, na ficha.
              </p>
            </ResumoDaAssinatura>
          </div>
        </fieldset>
      </form>
      <Modal
        aberto={revisando}
        aoFechar={() => setRevisando(false)}
        titulo="Criar o estabelecimento?"
        rodape={
          <>
            <Botao variante="secundaria" className="min-h-11" onClick={() => setRevisando(false)}>
              Voltar
            </Botao>
            <Botao className="min-h-11" onClick={criar}>
              Criar e convidar
            </Botao>
          </>
        }
      >
        <div className="space-y-3 text-sm" data-testid="revisao-criacao">
          <p className="font-semibold">{form.businessName}</p>
          <ul className="list-disc space-y-1 pl-5">
            {revisao.linhas.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {revisao.avisos.map((a) => (
            <p key={a} className="rounded-lg bg-paper-muted p-3">
              {a}
            </p>
          ))}
        </div>
      </Modal>
      <ResultadoEnvio
        estado={envio.estado}
        aoConsultar={() => void envio.consultar()}
        aoRepetir={() => envio.recomecar()}
        sucesso={(resultado) => (
          <Cartao>
            <CartaoCorpo className="space-y-3">
              <p className="font-semibold">
                {resultado.created ? "Estabelecimento criado e convite registrado." : "Este formulário já tinha sido enviado; nada novo foi criado."}
              </p>
              <p className="text-sm">
                Responsável: {resultado.invite.targetName} ({resultado.invite.targetEmail})
                {resultado.invite.targetUser?.hasCredential ? " · conta existente, vai aceitar com a própria senha" : " · conta nova, aguardando ativação"}
              </p>
              <SituacaoDoConvite convite={resultado.invite} detalhar />
              <div className="flex flex-wrap gap-2">
                {resultado.tenant && (
                  <LinkBotao href={rotaFichaEstabelecimento(resultado.tenant.id, "plano")} className="min-h-11">
                    Abrir a ficha
                  </LinkBotao>
                )}
                <Botao
                  variante="secundaria"
                  className="min-h-11"
                  onClick={() => {
                    setForm(vazio);
                    setAdicionais([]);
                    setAjustando(false);
                    envio.recomecar();
                  }}
                >
                  Cadastrar outro
                </Botao>
              </div>
            </CartaoCorpo>
          </Cartao>
        )}
      />
    </div>
  );
}
