import { afterEach, describe, expect, it, vi } from "vitest";
import { alterarStatusAgendamento } from "./appointment-status-api";

const AGENDAMENTO = {
  id: "a1",
  startAt: "2026-09-20T12:00:00.000Z",
  serviceEndAt: "2026-09-20T13:00:00.000Z",
  occupancyEndAt: "2026-09-20T13:00:00.000Z",
  localStart: "09:00",
  localServiceEnd: "10:00",
  timezone: "America/Sao_Paulo",
  status: "COMPLETED",
  durationMinutes: 60,
  priceCents: 5000,
  notes: null,
  professional: { id: "p1", name: "Ana" },
  service: { id: "s1", name: "Corte" },
  consumer: { id: "c1", name: "Maria", whatsapp: "(11) 90000-0000" },
  unitId: "u1",
  createdAt: "2026-09-19T12:00:00.000Z",
};

const MOSTRADO = { expectedStartAt: "2026-09-20T12:00:00.000Z" };

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("alterarStatusAgendamento", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["confirm", "start", "complete", "no-show"] as const)(
    "POST em .../%s só com o instante mostrado — nunca um status",
    async (acao) => {
      const fetchMock = mockFetch(201, { appointment: AGENDAMENTO });

      const resultado = await alterarStatusAgendamento("tenant_1", "a1", acao, MOSTRADO);

      expect(resultado.ok).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/tenants/tenant_1/appointments/a1/${acao}`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual(MOSTRADO);
    },
  );

  it("400 vira nao_agendavel com a mensagem do servidor, sem reenvio", async () => {
    const fetchMock = mockFetch(400, { message: "Só é possível registrar falta depois." });

    const resultado = await alterarStatusAgendamento("tenant_1", "a1", "no-show", MOSTRADO);

    expect(resultado).toEqual({
      ok: false,
      falha: { tipo: "nao_agendavel", mensagem: "Só é possível registrar falta depois." },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("409 vira horario_ocupado (reserva mudou desde que a agenda carregou)", async () => {
    mockFetch(409, { message: "O horário desta reserva mudou." });

    const resultado = await alterarStatusAgendamento("tenant_1", "a1", "complete", MOSTRADO);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("horario_ocupado");
  });

  it("escapa o id na URL", async () => {
    const fetchMock = mockFetch(201, { appointment: AGENDAMENTO });

    await alterarStatusAgendamento("tenant_1", "a/../b", "start", MOSTRADO);

    expect(fetchMock.mock.calls[0][0]).toContain("a%2F..%2Fb/start");
  });
});
