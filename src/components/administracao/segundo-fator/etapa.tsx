"use client";

// O que o portão mostra enquanto o segundo fator não libera o portal:
// - verificar: código do aplicativo ou de recuperação. Com uma liberação
//   usada nesta sessão (recuperação), também dá para cadastrar um novo
//   aplicativo; o atual continua valendo até o novo ser confirmado;
// - cadastrar: o assistente, se esta sessão pode cadastrar (convite de
//   plataforma ou liberação); senão, a explicação de como receber a
//   liberação.
import { useState } from "react";
import { Botao } from "@/components/ui/button";
import type { EstadoDoSegundoFatorNoAcesso } from "@/lib/administracao/contratos";
import { CadastroDoSegundoFator } from "./cadastro";
import { VerificacaoDoSegundoFator } from "./verificacao";

export function EtapaDoSegundoFator({
  etapa,
  segundoFator,
  email,
  aoConcluir,
}: {
  etapa: "verificar" | "cadastrar";
  segundoFator: EstadoDoSegundoFatorNoAcesso;
  email: string | null;
  aoConcluir: () => void;
}) {
  const [cadastrando, setCadastrando] = useState(false);

  return (
    <div className="mx-auto w-full max-w-lg rounded-xl border border-border bg-card p-6" data-testid="etapa-segundo-fator">
      {etapa === "verificar" && !cadastrando && (
        <div className="space-y-6">
          <VerificacaoDoSegundoFator aoConfirmar={aoConcluir} />
          {segundoFator.enrollmentPermitted && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm text-ink-soft">
                A administração liberou o cadastro de um novo aplicativo nesta sessão. O atual continua valendo até o novo ser
                confirmado.
              </p>
              <Botao variante="secundaria" className="min-h-11" onClick={() => setCadastrando(true)}>
                Cadastrar novo aplicativo
              </Botao>
            </div>
          )}
          {segundoFator.recoveryPending && !segundoFator.enrollmentPermitted && (
            <p className="border-t border-border pt-4 text-sm text-ink-soft" data-testid="recuperacao-pendente">
              Há uma liberação de recuperação enviada ao seu e-mail. Abra o link dele depois de entrar para cadastrar um novo
              aplicativo.
            </p>
          )}
        </div>
      )}
      {etapa === "verificar" && cadastrando && (
        <CadastroDoSegundoFator troca liberado email={email} aoConcluir={aoConcluir} aoCancelar={() => setCadastrando(false)} />
      )}
      {etapa === "cadastrar" &&
        (segundoFator.enrollmentPermitted ? (
          <CadastroDoSegundoFator troca={false} liberado email={email} aoConcluir={aoConcluir} />
        ) : (
          <div className="space-y-2" data-testid="cadastro-aguardando-liberacao">
            <h2 className="text-lg font-semibold">Cadastre a verificação em duas etapas</h2>
            <p className="text-sm text-ink-soft">
              O portal exige a verificação em duas etapas nesta conta. Para cadastrar o aplicativo autenticador, use o link de
              liberação enviado ao seu e-mail (ou o convite da administração) e siga as instruções. Se não recebeu, peça a outro
              proprietário da plataforma.
            </p>
          </div>
        ))}
    </div>
  );
}
