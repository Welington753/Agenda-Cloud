// Restauração de dados de demonstração. Separado de `index.ts` porque orquestra
// várias coleções + a semente original — não é mais um repositório de uma entidade.

import { restaurarDadosIniciais, writeCollection, STORAGE_KEYS } from "@/lib/storage/local-storage";
import { obterSeedCompleto } from "@/lib/seed-data";
import {
  agendamentoRepository,
  bloqueioRepository,
  consumidorRepository,
  conviteRepository,
  estabelecimentoRepository,
  membershipRepository,
  profissionalRepository,
  servicoRepository,
  unidadeRepository,
} from "@/lib/repositories";

/** Restaura SOMENTE os dados do tenant informado, sem tocar em nenhum outro
 * estabelecimento — é o botão de "restaurar demonstração" que fica dentro do
 * painel de cada estabelecimento. Faz merge in-place (mantém os registros dos
 * outros tenants como estão) e não recarrega a página: quem chamar deve invocar
 * `recarregar()` do `useClientData` para refletir o resultado na tela.
 *
 * Não mexe em `UsuarioEstabelecimento` — restaurar os dados de negócio de um
 * tenant não deve apagar a conta de uma pessoa, só o que pertence ao negócio
 * em si (agenda, serviços, consumidores, vínculos e convites daquele tenant). */
export function restaurarTenant(tenantId: string): void {
  const seed = obterSeedCompleto();

  const estabelecimentos = estabelecimentoRepository.listarTodos();
  const estabelecimentoSeed = seed.estabelecimentos.find((e) => e.tenantId === tenantId);
  if (estabelecimentoSeed) {
    writeCollection(
      STORAGE_KEYS.estabelecimentos,
      estabelecimentos.map((e) => (e.tenantId === tenantId ? estabelecimentoSeed : e))
    );
  }

  const substituirColecaoDoTenant = <T extends { tenantId: string }>(
    chave: string,
    atuais: T[],
    doSeed: T[]
  ): void => {
    const deOutrosTenants = atuais.filter((item) => item.tenantId !== tenantId);
    const frescosDoTenant = doSeed.filter((item) => item.tenantId === tenantId);
    writeCollection(chave, [...deOutrosTenants, ...frescosDoTenant]);
  };

  substituirColecaoDoTenant(STORAGE_KEYS.profissionais, profissionalRepository.listarTodos(), seed.profissionais);
  substituirColecaoDoTenant(STORAGE_KEYS.servicos, servicoRepository.listarTodos(), seed.servicos);
  substituirColecaoDoTenant(STORAGE_KEYS.consumidores, consumidorRepository.listarTodos(), seed.consumidores);
  substituirColecaoDoTenant(STORAGE_KEYS.agendamentos, agendamentoRepository.listarTodos(), seed.agendamentos);
  substituirColecaoDoTenant(STORAGE_KEYS.bloqueios, bloqueioRepository.listarTodos(), seed.bloqueios);
  substituirColecaoDoTenant(STORAGE_KEYS.unidades, unidadeRepository.listarTodos(), seed.unidades);

  const membershipsComTenantId = membershipRepository
    .listarTodos()
    .filter((m) => m.tenantId !== tenantId)
    .concat(seed.memberships.filter((m) => m.tenantId === tenantId));
  writeCollection(STORAGE_KEYS.memberships, membershipsComTenantId);

  const convitesComTenantId = conviteRepository
    .listarTodos()
    .filter((c) => c.tenantId !== tenantId)
    .concat(seed.convites.filter((c) => c.tenantId === tenantId));
  writeCollection(STORAGE_KEYS.convites, convitesComTenantId);
}

/** Apaga TODOS os dados simulados de TODOS os estabelecimentos (e das contas de
 * plataforma/equipe) e recarrega a página — só deve ficar acessível no painel
 * master. */
export function restaurarPlataformaCompleta(): void {
  restaurarDadosIniciais();
  window.location.reload();
}
