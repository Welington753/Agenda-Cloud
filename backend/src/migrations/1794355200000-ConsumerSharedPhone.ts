// Clientes, parte 3 (ver docs/plans/clientes-ficha-e-duplicados.md): o mesmo
// WhatsApp pode ter cadastros distintos no mesmo estabelecimento (ex.: mãe e
// filho). Remove `uq_consumers_tenant_whatsapp`.
//
// Ordem de publicação: só depois da API que funciona nos dois schemas (a do
// manifesto até ConsumerIdentity). Daqui em diante, quem impede o segundo
// cadastro do mesmo telefone sem pedido explícito é a aplicação, sob a trava
// por telefone (`travarTelefoneDoCliente`): 409 `TELEFONE_EM_USO`, a não ser
// com `outraPessoa`. A API anterior a ConsumerIdentity depende do UNIQUE
// para não duplicar o cadastro do telefone: depois desta migration, o piso é
// a API do manifesto até ConsumerIdentity, sempre para frente.
//
// A busca por `tenant_id` continua coberta pelo prefixo de
// `uq_consumers_tenant_id (tenant_id, id)`, e a busca por telefone de
// cadastros ativos, por `idx_consumers_tenant_whatsapp_name_active`.
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const SHARED_PHONE_CONSTRAINT = 'uq_consumers_tenant_whatsapp';

export class ConsumerSharedPhone1794355200000 implements MigrationInterface {
  name = 'ConsumerSharedPhone1794355200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE consumers DROP CONSTRAINT ${SHARED_PHONE_CONSTRAINT}`);
  }

  /** Só para ensaio. Recusa recriar o UNIQUE se algum telefone já tiver mais
   * de um cadastro no mesmo estabelecimento (seria preciso apagar ou alterar
   * cadastros, e nada é apagado). */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const [linha] = (await queryRunner.query(`
      SELECT count(*)::int AS repetidos FROM (
        SELECT 1 FROM consumers GROUP BY tenant_id, whatsapp_normalized HAVING count(*) > 1
      ) AS r
    `)) as { repetidos: number }[];
    if (linha.repetidos > 0) {
      throw new Error('ConsumerSharedPhone: já há telefones com mais de um cadastro; o retorno é só para frente.');
    }
    await queryRunner.query(
      `ALTER TABLE consumers ADD CONSTRAINT ${SHARED_PHONE_CONSTRAINT} UNIQUE (tenant_id, whatsapp_normalized)`,
    );
  }
}
