// Checagem sintática LEVE de YAML — não é um parser completo (o projeto não
// tem dependência de YAML instalada, e não é o caso de adicionar uma só
// para isto). Cobre os erros mais comuns em workflow do GitHub Actions:
// indentação com tab (proibida em YAML), indentação que não é múltiplo de 2
// espaços, e colchetes/chaves de coleção em fluxo desbalanceados. Não
// substitui um validador de verdade (`yamllint`, a própria UI do GitHub) —
// serve só para pegar erro grosseiro antes de commitar.
export interface YamlSanityResult {
  valid: boolean;
  errors: string[];
}

export function checkYamlSanity(content: string): YamlSanityResult {
  const errors: string[] = [];

  if (content.trim().length === 0) {
    return { valid: false, errors: ['Arquivo vazio.'] };
  }

  const lines = content.split('\n');
  let flowBalance = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (line.includes('\t')) {
      errors.push(`Linha ${lineNumber}: indentação com tab (YAML só aceita espaços).`);
    }

    const trimmed = line.trimStart();
    const isBlankOrComment = trimmed.length === 0 || trimmed.startsWith('#');
    if (!isBlankOrComment) {
      const leadingSpaces = line.length - trimmed.length;
      if (leadingSpaces % 2 !== 0) {
        errors.push(`Linha ${lineNumber}: indentação não é múltiplo de 2 espaços.`);
      }
    }

    for (const char of line) {
      if (char === '[' || char === '{') flowBalance++;
      if (char === ']' || char === '}') flowBalance--;
    }
  });

  if (flowBalance !== 0) {
    errors.push('Colchetes/chaves de coleção em fluxo desbalanceados no arquivo.');
  }

  return { valid: errors.length === 0, errors };
}
