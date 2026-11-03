"use client";

// Convite de PROPRIETÁRIO da plataforma (só um proprietário convida; o
// servidor confere). O portal não tem papel delegado: o convite sempre dá o
// papel de proprietário. Só para e-mail sem conta: para uma conta existente,
// o papel é ajustado na ficha, com a senha confirmada.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { ResultadoEnvio } from "./resultado-envio";
import { SituacaoDoConvite } from "./estado-envio";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { useEnvioComChave } from "@/lib/administracao/use-envio-com-chave";
import { ehResultadoCriacao } from "@/lib/administracao/contas";
import { PAPEL_ATRIBUIVEL } from "@/lib/administracao/rotulos";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export function ConvidarAdministrador({ aoConvidar }: { aoConvidar: () => void }) {
  const envio = useEnvioComChave(ehResultadoCriacao);
  const [form, setForm] = useState({ name: "", email: "" });

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    void envio
      .enviar((requestKey) =>
        acaoAdministrativa("/platform/invites", "POST", {
          requestKey,
          name: form.name,
          email: form.email,
          platformRole: PAPEL_ATRIBUIVEL,
          permissions: [],
        }),
      )
      .then(aoConvidar);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={aoEnviar} className="grid items-end gap-3 sm:grid-cols-2">
        <fieldset disabled={envio.estado.fase === "enviando" || envio.estado.fase === "incerto" || envio.estado.fase === "ok"} className="contents">
          <label className="min-w-0 text-sm font-medium">
            Nome
            <input required minLength={2} maxLength={120} className={CAMPO} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="min-w-0 text-sm font-medium">
            E-mail
            <input required type="email" maxLength={254} className={CAMPO} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </label>
          <p className="text-xs text-ink-soft sm:col-span-2">
            A pessoa passa a ser proprietária da plataforma, com acesso total ao portal. Confira a identidade antes:
            nenhum nome ou e-mail dá acesso por si só.
          </p>
          <div className="sm:col-span-2">
            <Botao type="submit" className="min-h-11">
              Convidar proprietário
            </Botao>
          </div>
        </fieldset>
      </form>
      <ResultadoEnvio
        estado={envio.estado}
        aoConsultar={() => void envio.consultar()}
        aoRepetir={() => envio.recomecar()}
        sucesso={(dados) => (
          <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">{dados.created ? "Convite registrado." : "Este convite já tinha sido criado."}</p>
            <SituacaoDoConvite convite={dados.invite} detalhar />
            <Botao
              variante="secundaria"
              className="min-h-11"
              onClick={() => {
                setForm({ name: "", email: "" });
                envio.recomecar();
              }}
            >
              Convidar outra pessoa
            </Botao>
          </div>
        )}
      />
    </div>
  );
}
