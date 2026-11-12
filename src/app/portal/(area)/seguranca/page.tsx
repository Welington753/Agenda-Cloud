"use client";

// Segurança da própria conta no portal: verificação em duas etapas. Ativar
// (fase opcional), trocar o aplicativo autenticador e gerar novos códigos de
// recuperação. Toda mudança pede a senha de novo e, com fator ativo, um código
// atual. O servidor decide e confere; a tela só desenha o que ele devolveu.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { CadastroDoSegundoFator } from "@/components/administracao/segundo-fator/cadastro";
import { CodigosDeRecuperacao } from "@/components/administracao/segundo-fator/codigos-de-recuperacao";
import { CampoCodigoDoAplicativo, CampoSenha, Erro } from "@/components/administracao/segundo-fator/campos";
import { confirmarSenha } from "@/lib/administracao/api-contas";
import { gerarNovosCodigos, lerSituacao, type SituacaoDoSegundoFator } from "@/lib/api/segundo-fator-api";
import { codigoDoAplicativoCompleto, mensagemDaFalha } from "@/lib/administracao/segundo-fator";
import { dataHora } from "@/lib/administracao/rotulos";
import { useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { useRealAuth } from "@/lib/auth/real-auth-context";

type Acao = "nenhuma" | "cadastrar" | "trocar" | "codigos";

export default function SegurancaDaConta() {
  const { estado: sessao } = useRealAuth();
  const { recarregar: recarregarAcesso } = useAcessoPlataforma();
  const email = sessao.status === "autenticado" ? sessao.sessao.user.email : null;
  const [situacao, setSituacao] = useState<SituacaoDoSegundoFator | null>(null);
  const [erroLeitura, setErroLeitura] = useState("");
  const [acao, setAcao] = useState<Acao>("nenhuma");

  const ler = useCallback(async () => {
    const r = await lerSituacao();
    if (r.ok) {
      setSituacao(r.dados);
      setErroLeitura("");
    } else setErroLeitura(mensagemDaFalha(r.falha));
  }, []);

  useEffect(() => {
    void ler();
  }, [ler]);

  function concluir() {
    setAcao("nenhuma");
    void ler();
    recarregarAcesso();
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Sua conta</p>
        <h1 className="mt-1 text-2xl font-bold">Segurança da conta</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          A verificação em duas etapas pede, além da senha, um código do aplicativo autenticador do seu celular para usar o
          portal. A confirmação vale por 12 horas nesta sessão.
        </p>
      </header>
      {erroLeitura && <Erro texto={erroLeitura} />}
      {!situacao && !erroLeitura && (
        <p role="status" className="text-sm text-ink-soft">
          Carregando…
        </p>
      )}
      {situacao && (
        <Cartao>
          <CartaoCorpo className="space-y-4" data-testid="situacao-segundo-fator">
            {acao === "nenhuma" && <Resumo situacao={situacao} aoEscolher={setAcao} />}
            {acao === "cadastrar" && (
              <CadastroDoSegundoFator
                troca={false}
                liberado={situacao.enrollmentPermitted}
                email={email}
                aoConcluir={concluir}
                aoCancelar={() => setAcao("nenhuma")}
              />
            )}
            {acao === "trocar" && (
              <CadastroDoSegundoFator
                troca
                liberado={situacao.enrollmentPermitted}
                email={email}
                aoConcluir={concluir}
                aoCancelar={() => setAcao("nenhuma")}
              />
            )}
            {acao === "codigos" && <NovosCodigos email={email} aoConcluir={concluir} aoCancelar={() => setAcao("nenhuma")} />}
          </CartaoCorpo>
        </Cartao>
      )}
    </div>
  );
}

function Resumo({ situacao, aoEscolher }: { situacao: SituacaoDoSegundoFator; aoEscolher: (a: Acao) => void }) {
  if (!situacao.factor) {
    return (
      <div className="space-y-3">
        <h2 className="font-semibold">Verificação em duas etapas: desativada</h2>
        <p className="text-sm text-ink-soft">Ative para que a senha sozinha não abra o portal.</p>
        {situacao.available ? (
          <Botao className="min-h-11" onClick={() => aoEscolher("cadastrar")}>
            Ativar a verificação em duas etapas
          </Botao>
        ) : (
          <p className="text-sm text-ink-soft">O cadastro está indisponível neste servidor no momento.</p>
        )}
      </div>
    );
  }
  const restantes = situacao.factor.remainingRecoveryCodes;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-semibold">Verificação em duas etapas: ativa</h2>
        <p className="text-sm text-ink-soft">
          Aplicativo autenticador cadastrado em {dataHora(situacao.factor.confirmedAt)}.
          {situacao.verifiedUntil && ` Confirmada nesta sessão até ${dataHora(situacao.verifiedUntil)}.`}
        </p>
        <p className={restantes <= 3 ? "text-sm font-medium text-danger" : "text-sm text-ink-soft"} data-testid="codigos-restantes">
          {restantes === 1 ? "Resta 1 código de recuperação." : `Restam ${restantes} códigos de recuperação.`}
          {restantes <= 3 && " Gere novos códigos."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Botao variante="secundaria" className="min-h-11" onClick={() => aoEscolher("trocar")} disabled={!situacao.available}>
          Trocar o aplicativo autenticador
        </Botao>
        <Botao variante="secundaria" className="min-h-11" onClick={() => aoEscolher("codigos")}>
          Gerar novos códigos de recuperação
        </Botao>
      </div>
      <p className="text-xs text-ink-soft">
        A verificação não pode ser desativada nesta conta. Perdeu o celular e os códigos? Peça a outro proprietário da
        plataforma uma liberação, que chega ao seu e-mail.
      </p>
    </div>
  );
}

function NovosCodigos({ email, aoConcluir, aoCancelar }: { email: string | null; aoConcluir: () => void; aoCancelar: () => void }) {
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [codigos, setCodigos] = useState<string[] | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    const s = await confirmarSenha(senha);
    if (s !== "ok") {
      setOcupado(false);
      setErro(s === "senha-incorreta" ? "Senha incorreta." : "Não foi possível confirmar a senha agora.");
      return;
    }
    setSenha("");
    const r = await gerarNovosCodigos(codigo);
    setOcupado(false);
    setCodigo("");
    if (r.ok) setCodigos(r.dados.recoveryCodes);
    else setErro(mensagemDaFalha(r.falha));
  }

  if (codigos) return <CodigosDeRecuperacao codigos={codigos} email={email} aoContinuar={aoConcluir} />;
  return (
    <form onSubmit={(e) => void enviar(e)} className="space-y-4" data-testid="novos-codigos">
      <h2 className="text-lg font-semibold">Gerar novos códigos de recuperação</h2>
      <p className="text-sm text-ink-soft">Os códigos atuais deixam de valer. As outras sessões desta conta são encerradas.</p>
      <CampoSenha valor={senha} aoMudar={setSenha} />
      <CampoCodigoDoAplicativo valor={codigo} aoMudar={setCodigo} />
      <Erro texto={erro} />
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" className="min-h-11" disabled={ocupado || senha.length < 10 || !codigoDoAplicativoCompleto(codigo)}>
          {ocupado ? "Gerando…" : "Gerar novos códigos"}
        </Botao>
        <Botao type="button" variante="fantasma" className="min-h-11" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
