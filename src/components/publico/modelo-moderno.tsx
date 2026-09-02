import { AtSign, Clock, Info, MapPin } from "lucide-react";
import { formatarDiasFuncionamento, formatarDuracao, formatarPrecoPublico } from "@/lib/format";
import { LinkBotao } from "@/components/ui/button";
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
  const logo = resolverLogo(identidade);
  const secoes = obterSecoesVisiveis({ estabelecimento, servicos, profissionais });
  const antesDaVisita = obterAntesDaVisita(estabelecimento);
  const rodape = obterRodapePersonalizado(estabelecimento);
  const linkAgendar = construirLinkAgendamento(slug);

  function renderizarSecao(secao: SecaoId) {
    switch (secao) {
      case "apresentacao":
        return identidade.textoApresentacao ? (
          <p key={secao} className="mx-auto mt-3 max-w-xl text-sm text-white/75">
            {identidade.textoApresentacao}
          </p>
        ) : null;
      case "servicos":
        return (
          <section key={secao}>
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
        );
      case "equipe":
        return (
          <section key={secao} className="mt-10">
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
        );
      case "fotos":
        return (
          <section key={secao} className="mt-10">
            <h2 className="text-lg font-bold text-ink">Fotos</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
    <div className="min-h-screen pb-28" style={{ backgroundColor: identidade.corSecundaria }}>
      <header className="px-4 py-14 text-white sm:px-8 sm:py-20" style={{ backgroundColor: identidade.corPrincipal }}>
        <div className="mx-auto max-w-4xl text-center">
          {logo.tipo === "imagem" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.url} alt={logo.alt} className="mx-auto size-20 rounded-full border border-white/20 object-cover" />
          ) : (
            <div
              className="mx-auto flex size-20 items-center justify-center rounded-full text-2xl font-bold"
              style={{ backgroundColor: identidade.corDestaque }}
            >
              {logo.texto}
            </div>
          )}
          <h1 className="mt-5 text-3xl font-bold sm:text-4xl">{identidade.nome}</h1>
          {renderizarSecao("apresentacao")}
          {agendamentoPublicoHabilitado && (
            <div className="mt-7">
              <LinkBotao href={linkAgendar} tamanho="lg" style={{ backgroundColor: identidade.corDestaque }}>
                Agendar {terminologia.agendamento.singular.toLowerCase()}
              </LinkBotao>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
        {secoes.filter((s) => s !== "apresentacao").map(renderizarSecao)}

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

        {rodape && <p className="mt-8 text-center text-sm text-ink-soft">{rodape}</p>}
        {exibirMarcaPlataforma(estabelecimento) && (
          <p className="mt-3 text-center text-xs text-ink-soft">Página criada com Agenda Cloud</p>
        )}
      </main>

      {agendamentoPublicoHabilitado && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card p-3 shadow-[var(--shadow-lift)]">
          <div className="mx-auto max-w-4xl">
            <LinkBotao href={linkAgendar} tamanho="lg" className="w-full" style={{ backgroundColor: identidade.corDestaque }}>
              Agendar {terminologia.agendamento.singular.toLowerCase()}
            </LinkBotao>
          </div>
        </div>
      )}
    </div>
  );
}
