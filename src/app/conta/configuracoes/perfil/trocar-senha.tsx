"use client";

// Troca da própria senha (Configurações → Perfil e segurança). No primeiro
// acesso com senha temporária, é a única coisa que a conta pode fazer: o
// shell leva a pessoa para cá, e o servidor recusa as demais rotas até a
// troca (`TROCA_DE_SENHA_OBRIGATORIA`).
//
// Um envio por vez (barreira síncrona contra clique duplo). Sem resposta, a
// troca pode ter acontecido: a tela diz isso e não reenvia.
import { useRef, useState, type FormEvent } from "react";
import { trocarSenha, type FalhaTrocaDeSenha } from "@/lib/api/auth-api";
import { Botao } from "@/components/ui/button";

const CAMPO =
  "w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent";

const MINIMO = 10;

function mensagem(falha: FalhaTrocaDeSenha): string {
  switch (falha.tipo) {
    case "senha_incorreta":
      return "A senha atual não confere.";
    case "limite_tentativas":
      return "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.";
    case "dados_invalidos":
      return falha.mensagem ?? "Confira as senhas: a nova precisa ter de 10 a 128 caracteres e ser diferente da atual.";
    case "nao_autenticado":
      return "Sua sessão terminou. Entre de novo.";
    case "falha_comunicacao":
      return "Não foi possível confirmar com o servidor. A senha pode ter sido trocada: tente entrar com a nova antes de repetir.";
    default:
      return "Não foi possível trocar a senha agora. Tente novamente em instantes.";
  }
}

export function TrocarSenha({ obrigatoria, aoTrocar }: { obrigatoria: boolean; aoTrocar: () => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const emVoo = useRef(false);

  const problema =
    nova.length > 0 && nova.length < MINIMO
      ? `A senha nova precisa ter pelo menos ${MINIMO} caracteres.`
      : confirmacao.length > 0 && confirmacao !== nova
        ? "A confirmação não é igual à senha nova."
        : nova.length > 0 && nova === atual
          ? "A senha nova precisa ser diferente da atual."
          : null;
  const pronto = atual.length > 0 && nova.length >= MINIMO && confirmacao === nova && nova !== atual;

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (!pronto || emVoo.current) return;
    emVoo.current = true;
    setEnviando(true);
    setErro(null);
    const resultado = await trocarSenha(atual, nova);
    emVoo.current = false;
    setEnviando(false);
    if (!resultado.ok) {
      setErro(mensagem(resultado.falha));
      return;
    }
    setAtual("");
    setNova("");
    setConfirmacao("");
    aoTrocar();
  }

  return (
    <form onSubmit={(e) => void aoEnviar(e)} className="space-y-3" data-testid="form-trocar-senha">
      {obrigatoria && (
        <p role="status" className="rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm text-ink" data-testid="troca-obrigatoria">
          Você entrou com uma senha temporária. Escolha a sua senha para continuar: até lá, a agenda e as demais áreas
          ficam bloqueadas.
        </p>
      )}
      <label className="block text-sm font-medium text-ink">
        {obrigatoria ? "Senha temporária" : "Senha atual"}
        <input
          type="password"
          autoComplete="current-password"
          value={atual}
          onChange={(e) => setAtual(e.target.value)}
          className={`mt-1 ${CAMPO}`}
        />
      </label>
      <label className="block text-sm font-medium text-ink">
        Senha nova
        <input
          type="password"
          autoComplete="new-password"
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          className={`mt-1 ${CAMPO}`}
          aria-describedby="regra-senha"
        />
      </label>
      <p id="regra-senha" className="text-xs text-ink-soft">
        De 10 a 128 caracteres. Ao trocar, as outras sessões abertas desta conta são encerradas.
      </p>
      <label className="block text-sm font-medium text-ink">
        Confirme a senha nova
        <input
          type="password"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          className={`mt-1 ${CAMPO}`}
        />
      </label>
      {(problema || erro) && (
        <p role="alert" className="text-sm text-ink" data-testid="erro-trocar-senha">
          {erro ?? problema}
        </p>
      )}
      <Botao type="submit" disabled={!pronto || enviando} aria-busy={enviando} data-testid="trocar-senha">
        {enviando ? "Trocando..." : "Trocar senha"}
      </Botao>
    </form>
  );
}
