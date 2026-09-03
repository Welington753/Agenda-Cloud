import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import type { EstadoFormulario } from "../page";
import { Campo, campoClasse } from "./campo";

interface EtapaIdentidadeProps {
  form: Pick<
    EstadoFormulario,
    "slug" | "nomeExibido" | "logoIniciais" | "corPrincipal" | "corSecundaria" | "corDestaque" | "modelo" | "textoApresentacao" | "instagram" | "endereco"
  >;
  erroSlug: string | null;
  aoMudarSlug: (slug: string) => void;
  atualizar: <K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) => void;
}

export function EtapaIdentidade({ form, erroSlug, aoMudarSlug, atualizar }: EtapaIdentidadeProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Identidade visual</CartaoTitulo>
        <Campo rotulo="Slug público">
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-soft">/</span>
            <input type="text" value={form.slug} onChange={(e) => aoMudarSlug(e.target.value)} className={campoClasse} />
          </div>
          {erroSlug && <p className="mt-1 text-xs text-[color:var(--color-danger)]">{erroSlug}</p>}
        </Campo>
        <Campo rotulo="Nome exibido na página pública">
          <input type="text" value={form.nomeExibido} onChange={(e) => atualizar("nomeExibido", e.target.value)} className={campoClasse} />
        </Campo>
        <Campo rotulo="Iniciais do logo">
          <input type="text" maxLength={3} value={form.logoIniciais} onChange={(e) => atualizar("logoIniciais", e.target.value)} className={campoClasse} />
        </Campo>
        <div className="grid grid-cols-3 gap-3">
          <Campo rotulo="Cor principal">
            <input type="color" value={form.corPrincipal} onChange={(e) => atualizar("corPrincipal", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
          </Campo>
          <Campo rotulo="Cor secundária">
            <input type="color" value={form.corSecundaria} onChange={(e) => atualizar("corSecundaria", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
          </Campo>
          <Campo rotulo="Cor de destaque">
            <input type="color" value={form.corDestaque} onChange={(e) => atualizar("corDestaque", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
          </Campo>
        </div>
        <Campo rotulo="Modelo da página pública">
          <div className="flex gap-2">
            {(["classico", "moderno"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => atualizar("modelo", m)}
                className={`flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-semibold capitalize ${
                  form.modelo === m ? "border-accent bg-accent text-white" : "border-border text-ink-soft"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Campo>
        <Campo rotulo="Texto de apresentação">
          <input type="text" value={form.textoApresentacao} onChange={(e) => atualizar("textoApresentacao", e.target.value)} className={campoClasse} />
        </Campo>
        <Campo rotulo="Instagram (opcional)">
          <input type="text" placeholder="@seuinstagram" value={form.instagram} onChange={(e) => atualizar("instagram", e.target.value)} className={campoClasse} />
        </Campo>

        <div className="rounded-[var(--radius-card)] border border-dashed border-border p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Pré-visualização</p>
          <div className="overflow-hidden rounded-[var(--radius-card)]" style={{ backgroundColor: form.corDestaque }}>
            <div className="flex items-center gap-3 p-4 text-white">
              <div className="flex size-10 items-center justify-center rounded-xl bg-white/15 text-sm font-bold">
                {form.logoIniciais || "??"}
              </div>
              <div>
                <p className="font-bold">{form.nomeExibido || "Nome do estabelecimento"}</p>
                <p className="text-xs text-white/80">{form.endereco || "Endereço"}</p>
              </div>
            </div>
          </div>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
