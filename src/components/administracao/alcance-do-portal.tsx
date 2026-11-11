// Alcance da lista e da Visão geral do portal (clientes, internos/teste,
// todos) e o selo "Interno/teste". Só desenha: a regra é do servidor
// (`tenants.is_test`), e o texto de alcance só afirma o recorte que a API
// confirmou (`alcanceConfirmado`).
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { ESCOPOS_DO_DIRETORIO, type EscopoDoDiretorio } from "@/lib/administracao/contratos-diretorio";
import { ESCOPOS, textoAlcance } from "@/lib/administracao/diretorio";

export function SeletorDeAlcance({
  valor,
  aoEscolher,
}: {
  valor: EscopoDoDiretorio;
  aoEscolher: (escopo: EscopoDoDiretorio) => void;
}) {
  return (
    <div role="group" aria-label="Alcance" className="flex flex-wrap gap-2" data-testid="seletor-de-alcance">
      {ESCOPOS_DO_DIRETORIO.map((escopo) => (
        <Botao
          key={escopo}
          variante={escopo === valor ? "primaria" : "secundaria"}
          aria-pressed={escopo === valor}
          className="min-h-11"
          onClick={() => escopo !== valor && aoEscolher(escopo)}
        >
          {ESCOPOS[escopo].rotulo}
        </Botao>
      ))}
    </div>
  );
}

export function TextoDeAlcance({ confirmado }: { confirmado: EscopoDoDiretorio | null }) {
  return (
    <p
      className={`text-sm ${confirmado ? "text-ink-soft" : "text-[color:var(--color-warning)]"}`}
      data-testid="alcance-dos-numeros"
      data-alcance={confirmado ?? "nao-confirmado"}
    >
      {textoAlcance(confirmado)}
    </p>
  );
}

export function SeloInternoTeste() {
  return (
    <Badge cor="aviso" data-testid="selo-interno-teste">
      Interno/teste
    </Badge>
  );
}
