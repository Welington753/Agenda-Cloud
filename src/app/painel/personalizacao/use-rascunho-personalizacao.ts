import { useEffect, useState, type ChangeEvent } from "react";
import { construirRascunhoPersonalizacao, rascunhosIguais, type RascunhoPersonalizacao } from "@/lib/estabelecimentos/rascunho";
import { validarArquivoLogo } from "@/lib/estabelecimentos/validacao";
import type { Estabelecimento } from "@/lib/types";

/** Estado de edição da personalização — reconstruído sempre que o tenant (ou o
 * estabelecimento salvo) muda, nunca mantendo edição pendente de outro tenant.
 * Não sabe salvar nada: isso depende de tenantId/permissão/notificação, que
 * ficam na página. */
export function useRascunhoPersonalizacao(estabelecimento: Estabelecimento | null) {
  const [rascunho, setRascunho] = useState<RascunhoPersonalizacao | null>(null);
  const [snapshot, setSnapshot] = useState<RascunhoPersonalizacao | null>(null);
  const [fotosTexto, setFotosTexto] = useState("");
  const [logoErro, setLogoErro] = useState<string | null>(null);

  useEffect(() => {
    if (!estabelecimento) return;
    const novoRascunho = construirRascunhoPersonalizacao(estabelecimento);
    setRascunho(novoRascunho);
    setSnapshot(novoRascunho);
    setFotosTexto(novoRascunho.fotos.join("\n"));
    setLogoErro(null);
  }, [estabelecimento]);

  function atualizar<K extends keyof RascunhoPersonalizacao>(campo: K, valor: RascunhoPersonalizacao[K]) {
    setRascunho((r) => (r ? { ...r, [campo]: valor } : r));
  }

  function aoMudarFotos(texto: string) {
    setFotosTexto(texto);
    atualizar(
      "fotos",
      texto
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
    );
  }

  function moverSecao(indice: number, direcao: -1 | 1) {
    setRascunho((r) => {
      if (!r) return r;
      const nova = [...r.ordemSecoes];
      const alvo = indice + direcao;
      if (alvo < 0 || alvo >= nova.length) return r;
      [nova[indice], nova[alvo]] = [nova[alvo], nova[indice]];
      return { ...r, ordemSecoes: nova };
    });
  }

  function aoSelecionarArquivoLogo(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!arquivo) return;
    const validacao = validarArquivoLogo({ type: arquivo.type, size: arquivo.size });
    if (!validacao.valido) {
      setLogoErro(validacao.motivo ?? "Arquivo inválido.");
      return;
    }
    setLogoErro(null);
    const leitor = new FileReader();
    leitor.onload = () => {
      if (typeof leitor.result === "string") atualizar("logoUrl", leitor.result);
    };
    leitor.readAsDataURL(arquivo);
  }

  function removerLogo() {
    atualizar("logoUrl", undefined);
    setLogoErro(null);
  }

  const cancelar = () => {
    setRascunho(snapshot);
    setFotosTexto(snapshot ? snapshot.fotos.join("\n") : "");
    setLogoErro(null);
  };

  const sujo = rascunho && snapshot ? !rascunhosIguais(rascunho, snapshot) : false;

  return {
    rascunho,
    snapshot,
    fotosTexto,
    logoErro,
    sujo,
    setFotosTexto,
    setLogoErro,
    atualizar,
    aoMudarFotos,
    moverSecao,
    aoSelecionarArquivoLogo,
    removerLogo,
    cancelar,
  };
}
