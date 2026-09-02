import { AtSign, CalendarCheck, Clock, Info, MapPin } from "lucide-react";
import { formatarDiasFuncionamento, formatarDuracao, formatarPrecoPublico } from "@/lib/format";
import { LinkBotao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import {
  construirLinkAgendamento,
  exibirMarcaPlataforma,
  obterAntesDaVisita,
  obterRodapePersonalizado,
  obterSecoesVisiveis,
  resolverLogo,
  type SecaoId,
} from "./secoes";
import type { ModeloPaginaPublicaProps } from "./tipos";

/** Modelo clássico: cabeçalho sólido na cor de destaque, conteúdo em uma coluna
 * central. Usado por padrão e pela Barbearia Dom Navalha / Clínica Sorriso Leve /
 * Barbeiro Bastião. */
export function ModeloClassico({
  slug,
  estabelecimento,
  profissionais,
  servicos,
  terminologia,
  agendamentoPublicoHabilitado,
}: ModeloPaginaPublicaProps) {
  const { identidadeVisual: identidade } = estabelecimento;
  const logo = resolverLogo(identidade);
  const secoes = obterSecoesVisiveis({ estabelecimento, servicos, profissionais });
  const antesDaVisita = obterAntesDaVisita(estabelecimento);
  const rodape = obterRodapePersonalizado(estabelecimento);
  const linkAgendar = construirLinkAgendamento(slug);

  function renderizarSecao(secao: SecaoId) {
    switch (secao) {
      case "apresentacao":
        return (
          <p key={secao} className="text-sm text-ink-soft">
            {identidade.textoApresentacao}
          </p>
        );
      case "servicos":
        return (
          <section key={secao} className="mt-8">
            <h2 className="text-lg font-bold text-ink">{terminologia.servico.plural}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {servicos.map((servico) => (
                <Cartao key={servico.id}>
                  <CartaoCorpo>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{servico.nome}</p>
                        <p className="mt-0.5 text-sm text-ink-soft">{servico.descricaoCurta}</p>
                      </div>
                      <p className="shrink-0 font-bold text-accent">
                        {formatarPrecoPublico(servico, estabelecimento.regras.exibirPrecoPublico)}
                      </p>
                    </div>
                    <p className="mt-3 text-xs font-medium text-ink-soft">{formatarDuracao(servico.duracaoMinutos)}</p>
                  </CartaoCorpo>
                </Cartao>
              ))}
            </div>
          </section>
        );
      case "equipe":
        return (
          <section key={secao} className="mt-8">
            <h2 className="text-lg font-bold text-ink">{terminologia.equipe}</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {profissionais.map((prof) => (
                <div key={prof.id} className="flex items-center gap-2.5 rounded-full border border-border bg-card py-1.5 pl-1.5 pr-4">
                  <div
                    className="flex size-9 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: prof.corAvatar }}
                  >
                    {prof.avatarIniciais}
                  </div>
                  <span className="text-sm font-medium text-ink">{prof.nome}</span>
                </div>
              ))}
            </div>
          </section>
        );
      case "fotos":
        return (
          <section key={secao} className="mt-8">
            <h2 className="text-lg font-bold text-ink">Fotos</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {identidade.fotos.map((foto, indice) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={foto}
                  src={foto}
                  alt={`Foto ${indice + 1} de ${identidade.nome}`}
                  className="aspect-square w-full rounded-[var(--radius-card)] border border-border object-cover"
                />
              ))}
            </div>
          </section>
        );
      default:
        return null;
    }
  }

  return (
    <div className="min-h-screen pb-24 sm:pb-10">
      <header className="px-4 py-10 text-white sm:px-8" style={{ backgroundColor: identidade.corDestaque }}>
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-4">
            {logo.tipo === "imagem" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo.url}
                alt={logo.alt}
                className="size-16 shrink-0 rounded-2xl border border-white/20 object-cover"
              />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-xl font-bold backdrop-blur">
                {logo.texto}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{identidade.nome}</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/85">
                <MapPin size={14} className="shrink-0" />
                {identidade.endereco}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/85">
            <span className="flex items-center gap-1.5">
              <Clock size={14} />
              {formatarDiasFuncionamento(estabelecimento.horarioGeral.diasFuncionamento)}, {estabelecimento.horarioGeral.abertura}
              {" às "}
              {estabelecimento.horarioGeral.fechamento}
            </span>
            {identidade.redesSociais?.instagram && (
              <span className="flex items-center gap-1.5">
                <AtSign size={14} />
                {identidade.redesSociais.instagram}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        {agendamentoPublicoHabilitado && (
          <div className="mb-6 hidden sm:block">
            <LinkBotao href={linkAgendar} tamanho="lg">
              Agendar {terminologia.agendamento.singular.toLowerCase()}
            </LinkBotao>
          </div>
        )}

        {secoes.map(renderizarSecao)}

        {agendamentoPublicoHabilitado ? (
          <section className="mt-10 flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-paper-muted/60 p-4 text-sm text-ink-soft">
            <CalendarCheck size={18} className="mt-0.5 shrink-0" />
            <p>
              {`Escolha ${terminologia.servico.artigo} ${terminologia.servico.singular.toLowerCase()}, ${terminologia.profissional.artigo === "a" ? "a" : "o"} ${terminologia.profissional.singular.toLowerCase()} (ou "qualquer ${terminologia.profissional.singular.toLowerCase()}") e o melhor horário. Sem necessidade de aplicativo.`}
            </p>
          </section>
        ) : (
          <section className="mt-10 flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-paper-muted/60 p-4 text-sm text-ink-soft">
            <Clock size={18} className="mt-0.5 shrink-0" />
            <p>Agendamento online desativado nesta demonstração. Entre em contato pelo telefone {identidade.telefone}.</p>
          </section>
        )}

        {antesDaVisita && (
          <section className="mt-6 flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft">
            <Info size={18} className="mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold text-ink">Antes da sua visita</p>
              {antesDaVisita.politicaCancelamento && <p>{antesDaVisita.politicaCancelamento}</p>}
              {antesDaVisita.orientacoes && <p>{antesDaVisita.orientacoes}</p>}
            </div>
          </section>
        )}

        {rodape && <p className="mt-10 text-center text-sm text-ink-soft">{rodape}</p>}
        {exibirMarcaPlataforma(estabelecimento) && (
          <p className="mt-3 text-center text-xs text-ink-soft">Página criada com Agenda Cloud</p>
        )}
      </main>

      {agendamentoPublicoHabilitado && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card p-3 shadow-[var(--shadow-lift)] sm:hidden">
          <LinkBotao href={linkAgendar} tamanho="lg" className="w-full">
            Agendar {terminologia.agendamento.singular.toLowerCase()}
          </LinkBotao>
        </div>
      )}
    </div>
  );
}
