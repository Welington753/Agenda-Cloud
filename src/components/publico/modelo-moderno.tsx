import Link from "next/link";
import { AtSign, Clock, MapPin } from "lucide-react";
import { formatarDiasFuncionamento, formatarDuracao, formatarPrecoPublico } from "@/lib/format";
import { Botao } from "@/components/ui/button";
import type { ModeloPaginaPublicaProps } from "./tipos";

/** Modelo moderno: hero cheio em tela, serviços em carrossel horizontal, equipe em
 * grade de avatares grandes e CTA fixo permanente (não só no mobile). Usado pela
 * Barbearia JR e por qualquer tenant que escolha `identidadeVisual.modelo === "moderno"`. */
export function ModeloModerno({
  slug,
  estabelecimento,
  profissionais,
  servicos,
  terminologia,
  agendamentoPublicoHabilitado,
}: ModeloPaginaPublicaProps) {
  const { identidadeVisual: identidade } = estabelecimento;

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: identidade.corSecundaria }}>
      <header className="px-4 py-14 text-white sm:px-8 sm:py-20" style={{ backgroundColor: identidade.corPrincipal }}>
        <div className="mx-auto max-w-4xl text-center">
          <div
            className="mx-auto flex size-20 items-center justify-center rounded-full text-2xl font-bold"
            style={{ backgroundColor: identidade.corDestaque }}
          >
            {identidade.logoIniciais}
          </div>
          <h1 className="mt-5 text-3xl font-bold sm:text-4xl">{identidade.nome}</h1>
          {identidade.textoApresentacao && <p className="mx-auto mt-3 max-w-xl text-sm text-white/75">{identidade.textoApresentacao}</p>}
          {agendamentoPublicoHabilitado && (
            <div className="mt-7">
              <Link href={`/${slug}/agendar`}>
                <Botao tamanho="lg" style={{ backgroundColor: identidade.corDestaque }}>
                  Agendar {terminologia.agendamento.singular.toLowerCase()}
                </Botao>
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
        <section>
          <h2 className="text-lg font-bold text-ink">{terminologia.servico.plural}</h2>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {servicos.map((servico) => (
              <div
                key={servico.id}
                className="w-56 shrink-0 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-soft)]"
              >
                <p className="font-semibold text-ink">{servico.nome}</p>
                <p className="mt-1 text-xs text-ink-soft">{servico.descricaoCurta}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-bold text-white"
                    style={{ backgroundColor: identidade.corDestaque }}
                  >
                    {formatarPrecoPublico(servico, estabelecimento.regras.exibirPrecoPublico)}
                  </span>
                  <span className="text-xs font-medium text-ink-soft">{formatarDuracao(servico.duracaoMinutos)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-bold text-ink">{terminologia.equipe}</h2>
          <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4">
            {profissionais.map((prof) => (
              <div key={prof.id} className="flex flex-col items-center gap-2 text-center">
                <div
                  className="flex size-16 items-center justify-center rounded-full text-lg font-bold text-white"
                  style={{ backgroundColor: prof.corAvatar }}
                >
                  {prof.avatarIniciais}
                </div>
                <span className="text-xs font-semibold text-ink">{prof.nome}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft sm:grid-cols-2">
          <span className="flex items-center gap-1.5">
            <MapPin size={14} className="shrink-0" /> {identidade.endereco}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={14} className="shrink-0" />
            {formatarDiasFuncionamento(estabelecimento.horarioGeral.diasFuncionamento)}, {estabelecimento.horarioGeral.abertura} às {estabelecimento.horarioGeral.fechamento}
          </span>
          {identidade.redesSociais?.instagram && (
            <span className="flex items-center gap-1.5">
              <AtSign size={14} className="shrink-0" /> {identidade.redesSociais.instagram}
            </span>
          )}
          {!agendamentoPublicoHabilitado && <span>Agendamento online desativado — ligue {identidade.telefone}.</span>}
        </section>

        {!identidade.personalizacaoAvancada?.ocultarMarcaPlataforma && (
          <p className="mt-8 text-center text-xs text-ink-soft">Página criada com Agenda Barber</p>
        )}
      </main>

      {agendamentoPublicoHabilitado && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card p-3 shadow-[var(--shadow-lift)]">
          <div className="mx-auto max-w-4xl">
            <Link href={`/${slug}/agendar`}>
              <Botao tamanho="lg" className="w-full" style={{ backgroundColor: identidade.corDestaque }}>
                Agendar {terminologia.agendamento.singular.toLowerCase()}
              </Botao>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
