"use client";

// Códigos de recuperação, mostrados UMA vez (logo depois do cadastro ou de
// gerar novos). Copiar e baixar acontecem só no navegador; nada vai ao
// servidor nem fica guardado depois que a pessoa continua.
import { useState } from "react";
import { Botao } from "@/components/ui/button";
import { textoDosCodigos } from "@/lib/administracao/segundo-fator";

export function CodigosDeRecuperacao({
  codigos,
  email,
  aoContinuar,
}: {
  codigos: string[];
  email: string | null;
  aoContinuar: () => void;
}) {
  const [guardei, setGuardei] = useState(false);
  const [copiado, setCopiado] = useState("");
  const texto = textoDosCodigos(codigos, email, new Date());

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado("Códigos copiados.");
    } catch {
      setCopiado("Não foi possível copiar. Selecione e copie os códigos à mão.");
    }
  }

  function baixar() {
    const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "agenda-cloud-codigos-de-recuperacao.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4" data-testid="codigos-de-recuperacao">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Guarde seus códigos de recuperação</h2>
        <p className="text-sm text-ink-soft">
          Se perder o celular, cada código permite entrar uma vez. Eles aparecem só agora: guarde em lugar seguro, longe do
          celular (gerenciador de senhas ou papel). Os códigos anteriores, se havia, não valem mais.
        </p>
      </div>
      <ol className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-paper-muted p-4 font-mono text-base sm:grid-cols-2">
        {codigos.map((c) => (
          <li key={c} className="break-all" data-testid="codigo-de-recuperacao">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => void copiar()}>
          Copiar todos
        </Botao>
        <Botao type="button" variante="secundaria" className="min-h-11" onClick={baixar}>
          Baixar .txt
        </Botao>
      </div>
      {copiado && (
        <p role="status" className="text-sm text-ink-soft">
          {copiado}
        </p>
      )}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={guardei} onChange={(e) => setGuardei(e.target.checked)} />
        Guardei os códigos em lugar seguro
      </label>
      <Botao type="button" className="min-h-11 w-full sm:w-auto" disabled={!guardei} onClick={aoContinuar}>
        Continuar
      </Botao>
    </div>
  );
}
