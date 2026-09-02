// Wrapper genérico sobre localStorage. Centraliza chaves e serialização para que a
// troca futura por uma API real signifique trocar apenas os repositórios que usam
// este arquivo, não os componentes de UI.

// v3: `Cliente` virou `Consumidor`, `Estabelecimento.plano`/`funcionalidades` viraram
// `plano`/`featuresDesativadas`/`limites`, e entraram as coleções de contas
// (usuários de plataforma/estabelecimento, memberships, convites, auditoria).
// Subir o namespace é a migração: chaves de versões antigas ficam órfãs e
// inofensivas, e tudo é resemeado no formato novo — mais seguro do que tentar
// migrar campo a campo um dado 100% descartável.
const NAMESPACE = "agenda-barber:v3:";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function readCollection<T>(chave: string, seed: T[]): T[] {
  if (!isBrowser()) return seed;
  const raw = window.localStorage.getItem(NAMESPACE + chave);
  if (raw === null) {
    window.localStorage.setItem(NAMESPACE + chave, JSON.stringify(seed));
    return seed;
  }
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return seed;
  }
}

export function writeCollection<T>(chave: string, dados: T[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(NAMESPACE + chave, JSON.stringify(dados));
}

export function readValue<T>(chave: string, seed: T): T {
  if (!isBrowser()) return seed;
  const raw = window.localStorage.getItem(NAMESPACE + chave);
  if (raw === null) {
    window.localStorage.setItem(NAMESPACE + chave, JSON.stringify(seed));
    return seed;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return seed;
  }
}

export function writeValue<T>(chave: string, valor: T): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(NAMESPACE + chave, JSON.stringify(valor));
}

export function restaurarDadosIniciais(): void {
  if (!isBrowser()) return;
  const chaves = Object.keys(window.localStorage).filter((k) => k.startsWith(NAMESPACE));
  chaves.forEach((k) => window.localStorage.removeItem(k));
}

export const STORAGE_KEYS = {
  estabelecimentos: "estabelecimentos",
  profissionais: "profissionais",
  servicos: "servicos",
  consumidores: "consumidores",
  agendamentos: "agendamentos",
  bloqueios: "bloqueios",
  unidades: "unidades",
  recursos: "recursos",
  usuariosPlataforma: "usuarios-plataforma",
  usuariosEstabelecimento: "usuarios-estabelecimento",
  memberships: "memberships",
  convites: "convites",
  auditoria: "auditoria",
  regrasComissao: "regras-comissao",
  lancamentosComissao: "lancamentos-comissao",
} as const;
