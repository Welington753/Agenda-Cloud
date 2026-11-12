"use client";

// Verificação em duas etapas de OUTRA conta da administração: enviar uma
// liberação (recuperação, ou primeiro cadastro de quem foi promovido). Exige
// motivo, a senha confirmada há pouco e o seu próprio código confirmado há
// pouco. O link vai só ao e-mail verificado da pessoa; esta tela nunca o vê.
// A liberação não remove o aplicativo atual nem dá acesso: só permite
// cadastrar um novo, depois da senha da pessoa.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { VerificacaoDoSegundoFator } from "@/components/administracao/segundo-fator/verificacao";
import { novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import { emitirLiberacao, type LiberacaoEmitida, type Resultado } from "@/lib/api/segundo-fator-api";
import { mensagemDaFalha } from "@/lib/administracao/segundo-fator";
import { useCapacidades } from "@/lib/administracao/use-acesso-plataforma";
import { dataHora } from "@/lib/administracao/rotulos";
import { CAMPO, type SecaoProps } from "./comum";

const ENVIO: Record<string, string> = {
  SENT: "E-mail aceito pelo provedor de envio.",
  FAILED: "O envio falhou. Tente de novo (o link anterior deixa de valer).",
  NOT_CONFIGURED: "O envio de e-mail não está configurado neste servidor.",
  PENDING: "Envio não confirmado.",
};

export function SecaoSegundoFator({ ficha }: SecaoProps) {
  const caps = useCapacidades();
  const executar = useAcaoSensivel();
  const [motivo, setMotivo] = useState("");
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [pedirCodigo, setPedirCodigo] = useState(false);
  const [emitida, setEmitida] = useState<LiberacaoEmitida | null>(null);

  if (!ficha.platformRole || !caps.managePlatformAccess) return null;

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    if (ocupado || motivo.trim().length < 3) return;
    setOcupado(true);
    setErro("");
    // A confirmação de senha é a mesma das outras ações sensíveis.
    let resultado: Resultado<LiberacaoEmitida> | null = null;
    const r = await executar(async () => {
      resultado = await emitirLiberacao(ficha.id, motivo.trim(), chave);
      if (!resultado.ok && resultado.falha.tipo === "reautenticar") return { tipo: "reautenticar" as const };
      return { tipo: "ok" as const, dados: null };
    });
    setOcupado(false);
    const final = resultado as Resultado<LiberacaoEmitida> | null;
    if (r.tipo === "reautenticar" || !final) {
      setErro("Confirme sua senha para enviar a liberação.");
      return;
    }
    if (final.ok) {
      setEmitida(final.dados);
      setMotivo("");
      setChave(novaChaveDeFormulario());
      return;
    }
    if (final.falha.tipo === "segundo-fator-recente") {
      setPedirCodigo(true);
      return;
    }
    setErro(mensagemDaFalha(final.falha));
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-4" data-testid="secao-segundo-fator">
        <div className="space-y-1">
          <h2 className="font-semibold">Verificação em duas etapas</h2>
          <p className="text-sm text-ink-soft">
            Se a pessoa perdeu o celular e os códigos de recuperação (ou acabou de ser promovida), envie uma liberação ao e-mail
            verificado dela ({ficha.email}). Ela entra com a própria senha e cadastra um novo aplicativo. As sessões dela são
            encerradas, e o aplicativo atual continua valendo até o novo ser confirmado.
          </p>
        </div>
        {pedirCodigo ? (
          <VerificacaoDoSegundoFator
            titulo="Confirme o seu código"
            explicacao="Antes de enviar a liberação, digite o código atual do SEU aplicativo autenticador."
            aoConfirmar={() => {
              setPedirCodigo(false);
              void enviar();
            }}
          />
        ) : (
          <form onSubmit={(e) => void enviar(e)} className="space-y-3">
            <label className="block text-sm font-medium">
              Motivo (fica no histórico)
              <textarea
                className={`${CAMPO} min-h-20 py-2`}
                maxLength={300}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                data-testid="motivo-liberacao"
              />
            </label>
            {erro && (
              <p role="alert" className="text-sm text-danger">
                {erro}
              </p>
            )}
            <Botao type="submit" variante="secundaria" className="min-h-11" disabled={ocupado || motivo.trim().length < 3}>
              {ocupado ? "Enviando…" : "Enviar liberação por e-mail"}
            </Botao>
          </form>
        )}
        {emitida && (
          <p role="status" className="text-sm" data-testid="liberacao-emitida">
            {emitida.created ? "Liberação enviada." : "Esta liberação já tinha sido enviada."} Válida até {dataHora(emitida.expiresAt)}.{" "}
            {ENVIO[emitida.delivery.status] ?? ""}
          </p>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
