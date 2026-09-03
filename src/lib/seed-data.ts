// Dados simulados. Cada estabelecimento é só configuração (categoria, identidade
// visual, plano/features, políticas) + dados sobre as mesmas entidades genéricas —
// nada aqui exige tratamento especial no motor de disponibilidade ou nos
// repositórios. Dom Navalha, Clínica Sorriso Leve, Barbearia JR e Barbeiro Bastião
// têm dados operacionais completos (provam que a mesma UI atende negócios de
// tamanhos/nichos diferentes); Corte Certo e Barbearia Vintage existem só para o
// painel master ter mais estabelecimentos na listagem (o segundo também demonstra
// um tenant suspenso).
//
// A geração está dividida por domínio em src/lib/seed/ (estabelecimentos,
// equipe, serviços, agendamentos, contas, comissões) — este arquivo só reexporta
// e orquestra (obterSeedCompleto), preservando os nomes já usados pelo resto do
// projeto.

import type {
  Agendamento,
  Bloqueio,
  Consumidor,
  Convite,
  Estabelecimento,
  LancamentoComissao,
  Membership,
  Profissional,
  Recurso,
  RegistroAuditoria,
  RegraComissao,
  Servico,
  Unidade,
  UsuarioEstabelecimento,
  UsuarioPlataforma,
} from "./types";
import { gerarAgendamentosEConsumidoresSeed, gerarBloqueiosSeed } from "./seed/agendamentos";
import { gerarRegrasComissaoSeed } from "./seed/comissoes";
import { gerarAuditoriaSeed, gerarConvitesSeed, gerarMembershipsSeed, gerarUsuariosEstabelecimentoSeed, gerarUsuariosPlataformaSeed } from "./seed/contas";
import { gerarEstabelecimentosSeed, gerarRecursosSeed, gerarUnidadesSeed } from "./seed/estabelecimentos";
import { gerarProfissionaisSeed } from "./seed/equipe";
import { gerarServicosSeed } from "./seed/servicos";

export {
  gerarAgendamentosEConsumidoresSeed,
  gerarBloqueiosSeed,
  gerarRegrasComissaoSeed,
  gerarAuditoriaSeed,
  gerarConvitesSeed,
  gerarMembershipsSeed,
  gerarUsuariosEstabelecimentoSeed,
  gerarUsuariosPlataformaSeed,
  gerarEstabelecimentosSeed,
  gerarRecursosSeed,
  gerarUnidadesSeed,
  gerarProfissionaisSeed,
  gerarServicosSeed,
};

let seedCompletoCache: {
  estabelecimentos: Estabelecimento[];
  profissionais: Profissional[];
  servicos: Servico[];
  agendamentos: Agendamento[];
  consumidores: Consumidor[];
  bloqueios: Bloqueio[];
  unidades: Unidade[];
  recursos: Recurso[];
  usuariosPlataforma: UsuarioPlataforma[];
  usuariosEstabelecimento: UsuarioEstabelecimento[];
  memberships: Membership[];
  convites: Convite[];
  auditoria: RegistroAuditoria[];
  regrasComissao: RegraComissao[];
  lancamentosComissao: LancamentoComissao[];
} | null = null;

/** Memoiza a geração para que agendamentos e consumidores (que são derivados
 * juntos) fiquem consistentes mesmo quando cada repositório lê sua própria
 * coleção. */
export function obterSeedCompleto() {
  if (!seedCompletoCache) {
    const { agendamentos, consumidores } = gerarAgendamentosEConsumidoresSeed();
    seedCompletoCache = {
      estabelecimentos: gerarEstabelecimentosSeed(),
      profissionais: gerarProfissionaisSeed(),
      servicos: gerarServicosSeed(),
      agendamentos,
      consumidores,
      bloqueios: gerarBloqueiosSeed(),
      unidades: gerarUnidadesSeed(),
      recursos: gerarRecursosSeed(),
      usuariosPlataforma: gerarUsuariosPlataformaSeed(),
      usuariosEstabelecimento: gerarUsuariosEstabelecimentoSeed(),
      memberships: gerarMembershipsSeed(),
      convites: gerarConvitesSeed(),
      auditoria: gerarAuditoriaSeed(),
      regrasComissao: gerarRegrasComissaoSeed(),
      // Sem backfill — só passa a existir a partir de agendamentos concluídos
      // depois desta implementação (ver AGENTS.md / plano da feature).
      lancamentosComissao: [],
    };
  }
  return seedCompletoCache;
}
