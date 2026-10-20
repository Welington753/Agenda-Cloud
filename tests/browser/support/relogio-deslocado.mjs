// Relógio DESLOCADO do backend, só para os testes de navegador que dependem
// da hora do dia (carregado por `node --import`, ver
// playwright.relogio-de-teste.config.ts).
// Nunca faz parte do build nem da hospedagem: o backend de produção sobe com
// `node dist/main.js`, sem este arquivo.
//
// `new Date()` e `Date.now()` passam a devolver o instante real somado a
// `E2E_RELOGIO_DESLOCAMENTO_MS`. O tempo continua correndo no ritmo real, e o
// navegador do teste (`page.clock.install`) começa no mesmo instante: backend,
// navegador e dados do spec veem o mesmo "agora". Datas com argumento
// (`new Date(iso)`, `Date.parse`, `Date.UTC`) não mudam.
const valor = process.env.E2E_RELOGIO_DESLOCAMENTO_MS;
const deslocamento = Number(valor);
if (!valor || !Number.isInteger(deslocamento)) {
  throw new Error(`E2E_RELOGIO_DESLOCAMENTO_MS inválido: ${JSON.stringify(valor)}`);
}

const DateReal = Date;
const agoraReal = DateReal.now.bind(DateReal);
const agora = () => agoraReal() + deslocamento;

globalThis.Date = new Proxy(DateReal, {
  construct(alvo, args, novoAlvo) {
    return Reflect.construct(alvo, args.length === 0 ? [agora()] : args, novoAlvo);
  },
  // `Date()` sem `new` devolve texto, como o original.
  apply() {
    return new DateReal(agora()).toString();
  },
  get(alvo, propriedade, receptor) {
    return propriedade === "now" ? agora : Reflect.get(alvo, propriedade, receptor);
  },
});
