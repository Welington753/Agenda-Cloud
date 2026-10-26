"use client";

// Convite de funcionário para UM profissional. O dono informa nome e e-mail;
// a senha é criada pela própria pessoa no link (ou ela aceita com a senha que
// já tem, se o e-mail já tiver conta). A chave do formulário evita convite
// duplicado se a resposta se perder (ver use-envio-com-chave.ts).
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { ResultadoEnvio } from "@/components/administracao/resultado-envio";
import { SituacaoDoConvite } from "@/components/administracao/estado-envio";
import { useEnvioComChave } from "@/lib/administracao/use-envio-com-chave";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { ehResultadoCriacao } from "@/lib/administracao/contas";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm";

export function ConvidarFuncionario({
  tenantId,
  professional,
  aoConcluir,
  aoCancelar,
}: {
  tenantId: string;
  professional: { id: string; name: string };
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const envio = useEnvioComChave(ehResultadoCriacao);
  const [nome, setNome] = useState(professional.name.replace(/^Profissional\s+/i, ""));
  const [email, setEmail] = useState("");
  const travado = envio.estado.fase === "enviando" || envio.estado.fase === "incerto" || envio.estado.fase === "ok";

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    void envio.enviar((requestKey) =>
      acaoAdministrativa(`/tenants/${encodeURIComponent(tenantId)}/team/invites`, "POST", {
        requestKey,
        professionalId: professional.id,
        name: nome,
        email,
      }),
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3" data-testid="convidar-funcionario">
      <form onSubmit={aoEnviar} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <fieldset disabled={travado} className="contents">
          <label className="min-w-0 text-sm font-medium">
            Nome da pessoa
            <input required minLength={2} maxLength={120} className={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label className="min-w-0 text-sm font-medium">
            E-mail
            <input
              required
              type="email"
              maxLength={254}
              autoComplete="off"
              className={CAMPO}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <Botao type="submit" className="min-h-11">
            Enviar convite
          </Botao>
        </fieldset>
      </form>
      <p className="text-xs text-ink-soft">
        A pessoa recebe um link válido por 24 horas e cria a própria senha (ou entra com a senha que já tem, se o
        e-mail já tiver conta). Você nunca vê nem define a senha dela. O e-mail só fica confirmado quando ela aceita o
        convite pelo link.
      </p>
      <ResultadoEnvio
        estado={envio.estado}
        aoConsultar={() => void envio.consultar()}
        aoRepetir={() => envio.recomecar()}
        sucesso={(dados) => (
          <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">{dados.created ? "Convite registrado." : "Este convite já tinha sido criado."}</p>
            <SituacaoDoConvite convite={dados.invite} detalhar />
            <Botao type="button" variante="secundaria" className="min-h-11" onClick={aoConcluir}>
              Concluir
            </Botao>
          </div>
        )}
      />
      {envio.estado.fase !== "ok" && (
        <Botao type="button" variante="fantasma" className="min-h-11" onClick={aoCancelar}>
          Cancelar
        </Botao>
      )}
    </div>
  );
}
