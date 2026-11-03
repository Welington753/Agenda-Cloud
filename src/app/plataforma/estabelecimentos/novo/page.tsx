"use client";

// Nova empresa com o responsável. O servidor cria estabelecimento (em teste,
// com o plano escolhido do catálogo), unidade principal, o contrato (ciclo e,
// se houver, valor específico deste cliente) e o convite de DONO numa
// transação só. E-mail sem conta gera uma conta PENDENTE, que só entra depois
// de ativar pelo link; e-mail com conta recebe um convite de vínculo e nada
// da pessoa muda. Escolher plano e preço NÃO registra pagamento.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { LinkBotao, Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { ResultadoEnvio } from "@/components/administracao/resultado-envio";
import { SituacaoDoConvite } from "@/components/administracao/estado-envio";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { useEnvioComChave } from "@/lib/administracao/use-envio-com-chave";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { ehPlanos, ehResultadoCriacao } from "@/lib/administracao/contas";
import { SEGMENTOS } from "@/lib/administracao/contratos";
import { centavosDe, reais } from "@/lib/administracao/validade";
import { ROTA_ESTABELECIMENTOS_ADMINISTRADOS, rotaFichaEstabelecimento } from "@/lib/administracao/rotas";
import { useCapacidades } from "@/lib/administracao/use-acesso-plataforma";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export default function NovoEstabelecimentoPage() {
  const capacidades = useCapacidades();
  const planos = useLeituraPlataforma("/platform/plans", ehPlanos);
  const envio = useEnvioComChave(ehResultadoCriacao);
  const vazio = {
    businessName: "",
    category: "OTHER",
    planId: "",
    billingCycle: "MONTHLY",
    contractAmount: "",
    name: "",
    email: "",
    phone: "",
  };
  const [form, setForm] = useState(vazio);
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
  if (planos.estado.status !== "pronto") return <EstadoLeitura estado={planos.estado} recarregar={planos.recarregar} />;

  const planoEscolhido = planos.estado.dados.find((p) => p.id === form.planId);
  const ciclo = form.billingCycle as "MONTHLY" | "QUARTERLY";
  const precoDoCatalogo = planoEscolhido?.cyclePrices?.[ciclo] ?? null;
  const valorContratado = form.contractAmount.trim() ? centavosDe(form.contractAmount) : null;
  const valorInvalido = form.contractAmount.trim() !== "" && valorContratado === null;

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (valorInvalido) return;
    void envio.enviar((requestKey) =>
      acaoAdministrativa("/platform/establishments", "POST", {
        requestKey,
        businessName: form.businessName,
        category: form.category,
        planId: form.planId,
        billingCycle: ciclo,
        ...(valorContratado !== null ? { contractAmountCents: valorContratado } : {}),
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
          Cria a empresa em período de teste e convida o responsável por e-mail. A pessoa define a própria senha ao
          ativar. Nenhuma senha é enviada nem definida aqui.
        </p>
      </header>
      <Cartao>
        <CartaoCorpo>
          <form onSubmit={aoEnviar} className="grid gap-4 sm:grid-cols-2">
            <fieldset disabled={bloqueado} className="contents">
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
              <label className="text-sm font-medium">
                Plano do catálogo
                <select required className={CAMPO} {...campo("planId")}>
                  <option value="">Escolha um plano</option>
                  {planos.estado.dados.map((plano) => (
                    <option key={plano.id} value={plano.id}>
                      {plano.name} · até {plano.maxProfessionals} profissionais
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                Ciclo
                <select className={CAMPO} {...campo("billingCycle")}>
                  <option value="MONTHLY">Mensal</option>
                  <option value="QUARTERLY">Trimestral</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Valor contratado específico (R$, opcional)
                <input className={CAMPO} inputMode="decimal" placeholder="0,00" {...campo("contractAmount")} />
              </label>
              <div className="text-xs text-ink-soft sm:col-span-2" data-testid="preco-criacao">
                {planoEscolhido ? (
                  <p>
                    Preço do catálogo ({ciclo === "MONTHLY" ? "mensal" : "trimestral"}):{" "}
                    <strong>{precoDoCatalogo === null ? "pendente (não definido)" : reais(precoDoCatalogo)}</strong>.{" "}
                    {valorContratado !== null
                      ? `Este cliente terá o valor contratado de ${reais(valorContratado)}.`
                      : "Sem valor específico, os pagamentos seguem o catálogo."}
                  </p>
                ) : (
                  <p>Escolha um plano para ver o preço.</p>
                )}
                <p className="mt-1">
                  Escolher plano e preço não registra pagamento nem comprova recebimento. O estabelecimento começa no teste
                  gratuito; o pagamento é registrado depois, na ficha.
                </p>
                {valorInvalido && <p className="text-[color:var(--color-danger)]">Valor contratado inválido.</p>}
              </div>
              <h2 className="pt-2 font-semibold sm:col-span-2">Responsável</h2>
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
              <div className="flex items-end sm:col-span-2">
                <Botao type="submit" className="min-h-11">
                  Criar e convidar
                </Botao>
              </div>
            </fieldset>
          </form>
        </CartaoCorpo>
      </Cartao>
      <ResultadoEnvio
        estado={envio.estado}
        aoConsultar={() => void envio.consultar()}
        aoRepetir={() => envio.recomecar()}
        sucesso={(dados) => (
          <Cartao>
            <CartaoCorpo className="space-y-3">
              <p className="font-semibold">
                {dados.created ? "Estabelecimento criado e convite registrado." : "Este formulário já tinha sido enviado; nada novo foi criado."}
              </p>
              <p className="text-sm">
                Responsável: {dados.invite.targetName} ({dados.invite.targetEmail})
                {dados.invite.targetUser?.hasCredential ? " · conta existente, vai aceitar com a própria senha" : " · conta nova, aguardando ativação"}
              </p>
              <SituacaoDoConvite convite={dados.invite} detalhar />
              <div className="flex flex-wrap gap-2">
                {dados.tenant && (
                  <LinkBotao href={rotaFichaEstabelecimento(dados.tenant.id)} className="min-h-11">
                    Abrir a ficha
                  </LinkBotao>
                )}
                <Botao
                  variante="secundaria"
                  className="min-h-11"
                  onClick={() => {
                    setForm(vazio);
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
