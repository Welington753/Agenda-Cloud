// Rótulos em português dos papéis reais de estabelecimento (`EstablishmentRole`
// do backend) — só apresentação, nunca usado para decidir permissão nenhuma
// (o backend nunca envia permissão granular, só o papel; regras de acesso
// completas continuam fora do escopo deste lote).
import type { PapelEstabelecimentoReal } from "@/lib/api/auth-api";

export const ROTULO_PAPEL_ESTABELECIMENTO_REAL: Record<PapelEstabelecimentoReal, string> = {
  DONO: "Dono(a)",
  GERENTE: "Gerente",
  RECEPCIONISTA: "Recepcionista",
  PROFISSIONAL: "Profissional",
};
