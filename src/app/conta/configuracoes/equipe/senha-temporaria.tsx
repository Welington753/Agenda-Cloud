"use client";

// Senha temporária devolvida pelo servidor UMA vez (criação do acesso ou nova
// senha). Fica só na memória desta tela: nada é gravado no navegador, e
// fechar o quadro descarta a senha. No primeiro acesso a pessoa troca por uma
// dela.
import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Botao } from "@/components/ui/button";

export function SenhaTemporaria({
  usuario,
  senha,
  aoFechar,
}: {
  usuario: string;
  senha: string;
  aoFechar: () => void;
}) {
  const [copiado, setCopiado] = useState<"sim" | "falhou" | null>(null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`Usuário: ${usuario}\nSenha temporária: ${senha}`);
      setCopiado("sim");
    } catch {
      setCopiado("falhou");
    }
  }

  return (
    <div
      role="status"
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-accent-soft p-4 text-sm text-ink"
      data-testid="senha-temporaria"
    >
      <p className="flex items-center gap-2 font-semibold">
        <KeyRound size={16} aria-hidden="true" />
        Entregue estes dados à pessoa
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-ink-soft">Usuário</dt>
        <dd className="font-mono font-semibold break-all" data-testid="senha-temporaria-usuario">
          {usuario}
        </dd>
        <dt className="text-ink-soft">Senha temporária</dt>
        <dd className="font-mono font-semibold break-all" data-testid="senha-temporaria-valor">
          {senha}
        </dd>
      </dl>
      <p className="text-xs text-ink-soft">
        Anote agora: esta senha não aparece de novo, nem para você. No primeiro acesso, a pessoa entra com o usuário
        e esta senha e escolhe a própria senha antes de ver a agenda.
      </p>
      <div className="flex flex-wrap gap-2">
        <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => void copiar()}>
          <Copy size={16} aria-hidden="true" />
          Copiar usuário e senha
        </Botao>
        <Botao type="button" variante="fantasma" className="min-h-11" onClick={aoFechar}>
          Já entreguei
        </Botao>
      </div>
      {copiado === "sim" && <p className="text-xs text-ink-soft">Copiado.</p>}
      {copiado === "falhou" && <p className="text-xs text-ink-soft">Não foi possível copiar: anote os dados acima.</p>}
    </div>
  );
}
