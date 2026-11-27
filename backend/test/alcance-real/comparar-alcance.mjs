// Compara duas coletas do alcance real (coletar-copia.db-e2e-spec.ts): a do
// código do piloto e a do código atual, sobre a mesma cópia restaurada.
// Uso: node comparar-alcance.mjs antes.json depois.json
//
// Compara vínculo a vínculo e rota a rota: recusa (status e `code`), resumo
// (IDs, totais, campos escondidos) e o SHA-256 da resposta inteira. Nada é
// normalizado: a coleta passa o mesmo instante e o mesmo período aos dois
// lados, e o teste com dados fictícios prova que duas execuções saem iguais.
// Imprime só contagens e chaves (vínculo e rota), nunca conteúdo.
import { readFileSync } from 'node:fs';

const [arquivoAntes, arquivoDepois] = process.argv.slice(2);
if (!arquivoAntes || !arquivoDepois) {
  console.error('uso: node comparar-alcance.mjs antes.json depois.json');
  process.exit(2);
}
const antes = JSON.parse(readFileSync(arquivoAntes, 'utf8'));
const depois = JSON.parse(readFileSync(arquivoDepois, 'utf8'));

const problemas = [];
if (JSON.stringify(antes.opcoes) !== JSON.stringify(depois.opcoes)) problemas.push('opções da coleta diferentes');
if (antes.migracoes !== depois.migracoes) problemas.push(`migrations ${antes.migracoes} x ${depois.migracoes}`);
for (const [lado, c] of [['antes', antes], ['depois', depois]]) {
  if (c.tabelasAlteradas.length) problemas.push(`${lado}: a coleta alterou ${c.tabelasAlteradas.length} tabela(s)`);
}

const porId = (c) => new Map(c.vinculos.map((v) => [v.membershipId, v]));
const a = porId(antes);
const d = porId(depois);
const diferencas = [];
for (const idVinculo of new Set([...a.keys(), ...d.keys()])) {
  const va = a.get(idVinculo);
  const vd = d.get(idVinculo);
  if (!va || !vd) {
    diferencas.push(`${idVinculo}: só ${va ? 'antes' : 'depois'}`);
    continue;
  }
  for (const rota of new Set([...Object.keys(va.respostas), ...Object.keys(vd.respostas)])) {
    const ra = va.respostas[rota];
    const rd = vd.respostas[rota];
    if (JSON.stringify(ra) !== JSON.stringify(rd)) {
      const tipo = !ra || !rd ? 'rota ausente' : ra.ok !== rd.ok ? 'recusa x resposta' : !ra.ok ? 'recusa diferente' : JSON.stringify(ra.resumo) !== JSON.stringify(rd.resumo) ? 'resumo diferente' : 'resposta inteira diferente';
      diferencas.push(`${va.role} ${idVinculo} ${rota}: ${tipo}`);
    }
  }
}

const rotas = new Map();
for (const v of depois.vinculos) {
  for (const [rota, r] of Object.entries(v.respostas)) {
    const chave = rota.replace(/\.\d+$/, '.*');
    const x = rotas.get(chave) ?? { atendidas: 0, recusadas: 0 };
    if (r.ok) x.atendidas++;
    else x.recusadas++;
    rotas.set(chave, x);
  }
}
const papeis = {};
for (const v of depois.vinculos) papeis[`${v.role}/${v.status}`] = (papeis[`${v.role}/${v.status}`] ?? 0) + 1;

console.log(`vínculos: ${d.size} (antes ${a.size}); por papel: ${JSON.stringify(papeis)}`);
console.log(`rotas (depois): ${JSON.stringify(Object.fromEntries(rotas))}`);
console.log(`problemas: ${problemas.length}${problemas.length ? `\n  ${problemas.join('\n  ')}` : ''}`);
console.log(`diferenças: ${diferencas.length}${diferencas.length ? `\n  ${diferencas.slice(0, 50).join('\n  ')}` : ''}`);
process.exit(problemas.length || diferencas.length ? 1 : 0);
