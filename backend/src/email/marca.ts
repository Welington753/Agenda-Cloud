// Marca usada nos e-mails. "Agenda Cloud" ainda é um nome provisório: trocar
// aqui muda o assunto, o texto, o rodapé e o remetente padrão de uma vez. O
// frontend tem o seu equivalente em `src/lib/config.ts` (`NOME_PRODUTO`).
//
// As cores seguem a paleta clara do site (`src/app/globals.css`). O botão usa
// o tom escuro do destaque (`--color-accent-hover`): texto branco sobre ele
// passa de 4,5:1, o que o tom principal não garante.
export const MARCA = {
  nome: 'Agenda Cloud',
  cores: {
    destaque: '#9a5417',
    sobreDestaque: '#ffffff',
    texto: '#1c1a17',
    textoSuave: '#4a453e',
    fundo: '#faf7f2',
    cartao: '#ffffff',
    borda: '#e6ddce',
  },
} as const;
