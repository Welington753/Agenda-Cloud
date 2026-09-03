import { Check, Copy, ExternalLink } from "lucide-react";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Botao } from "@/components/ui/button";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { EstadoConfiguracoes } from "../page";
import { Campo } from "./campo";

interface SecaoIdentidadeProps {
  form: Pick<EstadoConfiguracoes, "nome" | "nomeCurto" | "endereco" | "textoApresentacao" | "telefone" | "instagram" | "orientacoesAntesVisita">;
  terminologia: Terminologia;
  slugAtual: string;
  copiado: boolean;
  setForm: (atualizar: (f: EstadoConfiguracoes) => EstadoConfiguracoes) => void;
  copiarLink: () => void;
  abrirPaginaPublica: () => void;
}

const campoClasse = "w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink";

export function SecaoIdentidade({ form, terminologia, slugAtual, copiado, setForm, copiarLink, abrirPaginaPublica }: SecaoIdentidadeProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Identidade e informações públicas</CartaoTitulo>
        <Campo rotulo={`Nome ${terminologia.estabelecimento.artigo === "a" ? "da" : "do"} ${terminologia.estabelecimento.singular.toLowerCase()}`}>
          <input type="text" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} className={campoClasse} />
        </Campo>
        <Campo rotulo="Nome curto (usado no painel)">
          <input type="text" value={form.nomeCurto} onChange={(e) => setForm((f) => ({ ...f, nomeCurto: e.target.value }))} className={campoClasse} />
        </Campo>
        <Campo rotulo="Endereço">
          <input type="text" value={form.endereco} onChange={(e) => setForm((f) => ({ ...f, endereco: e.target.value }))} className={campoClasse} />
        </Campo>
        <Campo rotulo="Texto de apresentação">
          <textarea
            value={form.textoApresentacao}
            onChange={(e) => setForm((f) => ({ ...f, textoApresentacao: e.target.value }))}
            rows={3}
            className={campoClasse}
          />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Telefone/WhatsApp">
            <input type="text" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))} className={campoClasse} />
          </Campo>
          <Campo rotulo="Instagram">
            <input
              type="text"
              value={form.instagram}
              onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))}
              placeholder="@seuinstagram"
              className={campoClasse}
            />
          </Campo>
        </div>
        <Campo rotulo="Orientações antes da visita (opcional)">
          <textarea
            value={form.orientacoesAntesVisita}
            onChange={(e) => setForm((f) => ({ ...f, orientacoesAntesVisita: e.target.value }))}
            rows={3}
            placeholder={"Chegue com 5 minutos de antecedência.\nEstacionamento disponível na rua lateral.\nEm caso de atraso, entre em contato pelo WhatsApp."}
            className={campoClasse}
          />
          <p className="mt-1 text-xs text-ink-soft">
            Mostrado como texto simples na página pública, nunca como HTML.
          </p>
        </Campo>
        <Campo rotulo="Link público">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={`/${slugAtual}`}
              className="w-full rounded-[var(--radius-control)] border border-border bg-paper-muted px-3 py-2 text-sm text-ink-soft"
            />
            <Botao tamanho="sm" variante="secundaria" onClick={copiarLink} aria-label="Copiar link público">
              {copiado ? <Check size={16} /> : <Copy size={16} />}
            </Botao>
            <Botao tamanho="sm" variante="secundaria" onClick={abrirPaginaPublica}>
              <ExternalLink size={16} className="mr-1.5" /> Abrir página pública
            </Botao>
          </div>
        </Campo>
      </CartaoCorpo>
    </Cartao>
  );
}
