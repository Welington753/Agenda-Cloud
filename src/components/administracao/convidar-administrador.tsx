"use client";

// Convite para a administração da PLATAFORMA (só MASTER_OWNER; o servidor
// confere). Só para e-mail sem conta: para uma conta existente, o papel é
// ajustado na ficha do usuário, com a senha confirmada.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { ResultadoEnvio } from "./resultado-envio";
import { SituacaoDoConvite } from "./estado-envio";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { useEnvioComChave } from "@/lib/administracao/use-envio-com-chave";
import { ehResultadoCriacao } from "@/lib/administracao/contas";
import { PAPEIS_PLATAFORMA, PERMISSOES_PLATAFORMA } from "@/lib/administracao/rotulos";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export function ConvidarAdministrador({ aoConvidar }: { aoConvidar: () => void }) {
  const envio = useEnvioComChave(ehResultadoCriacao);
  const [form, setForm] = useState({ name: "", email: "", platformRole: "MASTER_ADMIN", gerencia: true });
  const comPermissao = form.platformRole !== "MASTER_OWNER";

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    void envio
      .enviar((requestKey) =>
        acaoAdministrativa("/platform/invites", "POST", {
          requestKey,
          name: form.name,
          email: form.email,
          platformRole: form.platformRole,
          permissions: comPermissao && form.gerencia ? ["ESTABLISHMENTS_MANAGE"] : [],
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
          <label className="min-w-0 text-sm font-medium">
            Papel na plataforma
            <select className={CAMPO} value={form.platformRole} onChange={(e) => setForm((f) => ({ ...f, platformRole: e.target.value }))}>
              {Object.entries(PAPEIS_PLATAFORMA).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              disabled={!comPermissao}
              checked={comPermissao && form.gerencia}
              onChange={(e) => setForm((f) => ({ ...f, gerencia: e.target.checked }))}
            />
            {PERMISSOES_PLATAFORMA.ESTABLISHMENTS_MANAGE}
          </label>
          <div className="sm:col-span-2">
            <Botao type="submit" className="min-h-11">
              Convidar para a administração
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
                setForm({ name: "", email: "", platformRole: "MASTER_ADMIN", gerencia: true });
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
