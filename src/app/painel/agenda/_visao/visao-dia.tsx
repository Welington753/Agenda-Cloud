import { UserRound } from "lucide-react";
import { EstadoVazio } from "@/components/ui/empty-state";
import type { Agendamento, Bloqueio, Permission, Profissional, Servico, StatusAgendamento } from "@/lib/types";
import type { Terminologia } from "@/lib/verticals/terminologia";
import { agendamentosDoDia, bloqueiosDoDia } from "../selecao-do-dia";
import { CartaoProfissionalDia } from "./cartao-profissional-dia";

interface VisaoDiaProps {
  dataAtual: Date;
  profissionaisExibidos: Profissional[];
  agendamentos: Agendamento[];
  bloqueios: Bloqueio[];
  filtroStatus: StatusAgendamento | "todos";
  servicoPorId: Map<string, Servico>;
  podeAcessar: (permissao: Permission) => { permitido: boolean };
  terminologia: Terminologia;
  aoSelecionarAgendamento: (agendamento: Agendamento) => void;
  aoNovoAgendamento: (profissionalId: string) => void;
  aoNovoBloqueio: (profissionalId: string) => void;
  aoRemoverBloqueio: (bloqueioId: string) => void;
}

export function VisaoDia({
  dataAtual,
  profissionaisExibidos,
  agendamentos,
  bloqueios,
  filtroStatus,
  servicoPorId,
  podeAcessar,
  terminologia,
  aoSelecionarAgendamento,
  aoNovoAgendamento,
  aoNovoBloqueio,
  aoRemoverBloqueio,
}: VisaoDiaProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {profissionaisExibidos.map((prof) => (
        <CartaoProfissionalDia
          key={prof.id}
          profissional={prof}
          itensAgendamento={agendamentosDoDia(agendamentos, prof.id, dataAtual, filtroStatus)}
          itensBloqueio={bloqueiosDoDia(bloqueios, prof.id, dataAtual)}
          servicoPorId={servicoPorId}
          podeAcessar={podeAcessar}
          terminologia={terminologia}
          aoSelecionarAgendamento={aoSelecionarAgendamento}
          aoNovoAgendamento={aoNovoAgendamento}
          aoNovoBloqueio={aoNovoBloqueio}
          aoRemoverBloqueio={aoRemoverBloqueio}
        />
      ))}
      {profissionaisExibidos.length === 0 && (
        <EstadoVazio
          icone={UserRound}
          titulo={`Nenhum${terminologia.profissional.artigo === "a" ? "a" : ""} ${terminologia.profissional.singular.toLowerCase()} cadastrad${terminologia.profissional.artigo === "a" ? "a" : "o"}`}
        />
      )}
    </div>
  );
}
