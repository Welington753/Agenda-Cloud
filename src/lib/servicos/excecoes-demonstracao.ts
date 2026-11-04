// Única passagem permitida da área real para a demonstração, compartilhada
// pelas duas guardas (sem-dados-demo.test.ts e sem-dados-demo-transitivo.test.ts).
//
// O `/login` mostra os botões de "Acessos para demonstração", que entram pela
// sessão simulada sem tocar a API real (ver o cabeçalho de
// src/app/login/page.tsx). Para isso a página precisa destes dois módulos, e
// só ela. A exceção é por arquivo e por módulo: outro arquivo, inclusive um
// componente compartilhado como src/components/auth/*, ou outro módulo da
// demonstração na própria página de login continuam reprovados.
export interface ExcecaoDemonstracao {
  /** Arquivo da área real, relativo à raiz do repositório. */
  arquivo: string;
  /** Especificador exato do import. */
  modulo: string;
  /** Arquivo que o especificador resolve, relativo à raiz do repositório. */
  destino: string;
}

export const EXCECOES_DEMONSTRACAO: readonly ExcecaoDemonstracao[] = [
  { arquivo: "src/app/login/page.tsx", modulo: "@/lib/auth/auth-context", destino: "src/lib/auth/auth-context.tsx" },
  { arquivo: "src/app/login/page.tsx", modulo: "@/lib/auth/autenticacao", destino: "src/lib/auth/autenticacao.ts" },
];
