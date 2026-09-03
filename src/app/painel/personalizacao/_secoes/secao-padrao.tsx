import { Upload, X } from "lucide-react";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import type { RascunhoPersonalizacao } from "@/lib/estabelecimentos/rascunho";
import type { ModeloPaginaPublica } from "@/lib/types";
import type { ChangeEvent } from "react";

interface SecaoPadraoProps {
  rascunho: Pick<RascunhoPersonalizacao, "logoUrl" | "logoIniciais" | "modelo" | "corPrincipal" | "corSecundaria" | "corDestaque">;
  fotosTexto: string;
  logoErro: string | null;
  atualizar: <K extends keyof RascunhoPersonalizacao>(campo: K, valor: RascunhoPersonalizacao[K]) => void;
  aoMudarFotos: (texto: string) => void;
  aoSelecionarArquivoLogo: (evento: ChangeEvent<HTMLInputElement>) => void;
  removerLogo: () => void;
}

export function SecaoPadrao({ rascunho, fotosTexto, logoErro, atualizar, aoMudarFotos, aoSelecionarArquivoLogo, removerLogo }: SecaoPadraoProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Padrão (disponível em todos os planos)</CartaoTitulo>

        <div>
          <label className="mb-2 block text-xs font-semibold text-ink-soft">Logo</label>
          <div className="flex items-center gap-3">
            {rascunho.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rascunho.logoUrl} alt="Prévia do logo" className="size-14 rounded-xl border border-border object-cover" />
            ) : (
              <div
                className="flex size-14 items-center justify-center rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: rascunho.corDestaque }}
              >
                {rascunho.logoIniciais.slice(0, 3).toUpperCase() || "??"}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper-muted">
                <Upload size={14} /> Enviar logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={aoSelecionarArquivoLogo}
                  className="sr-only"
                />
              </label>
              {rascunho.logoUrl && (
                <button
                  type="button"
                  onClick={removerLogo}
                  className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-ink-soft hover:underline"
                >
                  <X size={12} /> Remover logo
                </button>
              )}
            </div>
          </div>
          {logoErro && <p className="mt-1.5 text-xs text-[color:var(--color-danger)]">{logoErro}</p>}
          <p className="mt-1.5 text-xs text-ink-soft">
            PNG, JPEG ou WEBP, até 500 KB. Armazenado somente neste navegador durante a demonstração — na versão
            real, o arquivo será enviado ao armazenamento seguro da plataforma. Sem logo, as iniciais abaixo são
            usadas no lugar.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Iniciais (fallback sem logo)</label>
          <input
            type="text"
            value={rascunho.logoIniciais}
            onChange={(e) => atualizar("logoIniciais", e.target.value.toUpperCase().slice(0, 3))}
            maxLength={3}
            className="w-24 rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Modelo da página pública</label>
          <div className="flex gap-2">
            {(["classico", "moderno"] as const).map((m: ModeloPaginaPublica) => (
              <button
                key={m}
                type="button"
                aria-pressed={rascunho.modelo === m}
                onClick={() => atualizar("modelo", m)}
                className={`flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-semibold capitalize ${
                  rascunho.modelo === m ? "border-accent bg-accent text-white" : "border-border text-ink-soft"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor principal</label>
            <input type="color" value={rascunho.corPrincipal} onChange={(e) => atualizar("corPrincipal", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor secundária</label>
            <input type="color" value={rascunho.corSecundaria} onChange={(e) => atualizar("corSecundaria", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor de destaque</label>
            <input type="color" value={rascunho.corDestaque} onChange={(e) => atualizar("corDestaque", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Fotos (uma URL por linha)</label>
          <textarea
            value={fotosTexto}
            onChange={(e) => aoMudarFotos(e.target.value)}
            rows={3}
            placeholder="https://..."
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
          <p className="mt-1 text-xs text-ink-soft">
            Sem upload de fotos nesta demonstração — cole o link de uma imagem já hospedada (https://).
          </p>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
