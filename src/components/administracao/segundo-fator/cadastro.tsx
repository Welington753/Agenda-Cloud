"use client";

// Cadastro (primeiro ou troca) do aplicativo autenticador, em três passos:
// 1. senha (e, na troca sem liberação, um código atual do aplicativo ou de
//    recuperação);
// 2. QR code, chave manual (com "copiar") e o link `otpauth://` para quem
//    está no próprio celular; um código do aplicativo confirma o cadastro;
// 3. códigos de recuperação, mostrados uma vez.
// O fator só passa a valer no passo 2, depois de um código válido. Segredo,
// chave e códigos ficam só no estado deste componente.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { confirmarSenha } from "@/lib/administracao/api-contas";
import { confirmarCadastro, iniciarCadastro, type CadastroIniciado } from "@/lib/api/segundo-fator-api";
import {
  codigoDeRecuperacaoCompleto,
  codigoDoAplicativoCompleto,
  limparCodigoDeRecuperacao,
  mensagemDaFalha,
} from "@/lib/administracao/segundo-fator";
import { CampoCodigoDoAplicativo, CampoSenha, Erro } from "./campos";
import { CodigosDeRecuperacao } from "./codigos-de-recuperacao";

const MENSAGEM_SENHA: Record<string, string> = {
  "senha-incorreta": "Senha incorreta.",
  limite: "Muitas tentativas. Aguarde alguns minutos.",
  rede: "Não foi possível falar com o servidor. Tente de novo.",
  erro: "Não foi possível confirmar agora.",
};

export function CadastroDoSegundoFator({
  troca,
  liberado,
  email,
  aoConcluir,
  aoCancelar,
}: {
  /** Já existe um fator ativo: o novo só substitui depois de confirmado. */
  troca: boolean;
  /** A sessão pode cadastrar sem outro código (convite ou liberação). */
  liberado: boolean;
  email: string | null;
  aoConcluir: () => void;
  aoCancelar?: () => void;
}) {
  const [passo, setPasso] = useState<"senha" | "qr" | "codigos">("senha");
  const [senha, setSenha] = useState("");
  const [atual, setAtual] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cadastro, setCadastro] = useState<CadastroIniciado | null>(null);
  const [codigos, setCodigos] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState("");
  const pedeCodigoAtual = troca && !liberado;
  const atualCompleto = codigoDoAplicativoCompleto(atual) || codigoDeRecuperacaoCompleto(atual);

  async function comecar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    const s = await confirmarSenha(senha);
    if (s !== "ok") {
      setOcupado(false);
      setErro(MENSAGEM_SENHA[s]);
      return;
    }
    setSenha("");
    const r = await iniciarCadastro(pedeCodigoAtual ? atual : undefined);
    setOcupado(false);
    setAtual("");
    if (!r.ok) {
      setErro(mensagemDaFalha(r.falha));
      return;
    }
    setCadastro(r.dados);
    setPasso("qr");
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (ocupado || !codigoDoAplicativoCompleto(codigo)) return;
    setOcupado(true);
    setErro("");
    const r = await confirmarCadastro(codigo);
    setOcupado(false);
    setCodigo("");
    if (!r.ok) {
      if (r.falha.tipo === "cadastro-expirado" || r.falha.tipo === "cadastro-inexistente") {
        setCadastro(null);
        setPasso("senha");
      }
      setErro(mensagemDaFalha(r.falha));
      return;
    }
    setCadastro(null);
    setCodigos(r.dados.recoveryCodes);
    setPasso("codigos");
  }

  async function copiarChave() {
    if (!cadastro) return;
    try {
      await navigator.clipboard.writeText(cadastro.manualKey.replace(/ /g, ""));
      setCopiado("Chave copiada.");
    } catch {
      setCopiado("Não foi possível copiar. Digite a chave no aplicativo.");
    }
  }

  if (passo === "codigos") {
    return <CodigosDeRecuperacao codigos={codigos} email={email} aoContinuar={aoConcluir} />;
  }

  if (passo === "qr" && cadastro) {
    return (
      <form onSubmit={(e) => void confirmar(e)} className="space-y-4" data-testid="cadastro-qr">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Cadastre no aplicativo autenticador</h2>
          <p className="text-sm text-ink-soft">
            Use Google Authenticator, Microsoft Authenticator, Authy, 1Password ou outro aplicativo de códigos (TOTP). Leia o
            QR code com o aplicativo, ou digite a chave abaixo. No próprio celular, use o botão para abrir o aplicativo.
          </p>
        </div>
        {/* SVG do servidor exibido como imagem: nada dele é executado. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(cadastro.qrSvg)}`}
          alt="QR code para cadastrar o Agenda Cloud no aplicativo autenticador"
          className="mx-auto w-full max-w-60 rounded-lg border border-border bg-white p-2"
          data-testid="qr-code"
        />
        <div className="space-y-2">
          <p className="text-sm font-medium">Chave para digitar no aplicativo</p>
          <p className="break-all rounded-lg border border-border bg-paper-muted p-3 font-mono text-base" data-testid="chave-manual">
            {cadastro.manualKey}
          </p>
          <div className="flex flex-wrap gap-2">
            <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => void copiarChave()}>
              Copiar chave
            </Botao>
            <a
              href={cadastro.otpauthUri}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-control px-4 text-sm font-semibold"
            >
              Abrir no aplicativo autenticador
            </a>
          </div>
          {copiado && (
            <p role="status" className="text-sm text-ink-soft">
              {copiado}
            </p>
          )}
        </div>
        <CampoCodigoDoAplicativo valor={codigo} aoMudar={setCodigo} rotulo="Código que o aplicativo mostra agora" />
        <Erro texto={erro} />
        <div className="flex flex-wrap gap-2">
          <Botao type="submit" className="min-h-11" disabled={ocupado || !codigoDoAplicativoCompleto(codigo)}>
            {ocupado ? "Confirmando…" : "Confirmar cadastro"}
          </Botao>
          {aoCancelar && (
            <Botao type="button" variante="fantasma" className="min-h-11" onClick={aoCancelar}>
              Cancelar
            </Botao>
          )}
        </div>
        <p className="text-xs text-ink-soft">
          {troca
            ? "O aplicativo anterior continua valendo até este cadastro ser confirmado."
            : "A verificação só fica ativa depois do código confirmado."}
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void comecar(e)} className="space-y-4" data-testid="cadastro-senha">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{troca ? "Trocar o aplicativo autenticador" : "Ativar a verificação em duas etapas"}</h2>
        <p className="text-sm text-ink-soft">
          {troca
            ? "Confirme sua senha para cadastrar um novo aplicativo. O atual continua valendo até o novo ser confirmado."
            : "Além da senha, o portal vai pedir um código do aplicativo autenticador do seu celular. Confirme sua senha para começar."}
        </p>
      </div>
      <CampoSenha valor={senha} aoMudar={setSenha} />
      {pedeCodigoAtual && (
        <label className="block text-sm font-medium text-ink">
          Código atual do aplicativo (ou um código de recuperação)
          <input
            type="text"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={40}
            value={atual}
            onChange={(e) => setAtual(limparCodigoDeRecuperacao(e.target.value))}
            className="mt-1 min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-center text-lg tracking-widest"
            data-testid="campo-codigo-atual"
          />
        </label>
      )}
      <Erro texto={erro} />
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" className="min-h-11" disabled={ocupado || senha.length < 10 || (pedeCodigoAtual && !atualCompleto)}>
          {ocupado ? "Confirmando…" : "Continuar"}
        </Botao>
        {aoCancelar && (
          <Botao type="button" variante="fantasma" className="min-h-11" onClick={aoCancelar}>
            Cancelar
          </Botao>
        )}
      </div>
    </form>
  );
}
