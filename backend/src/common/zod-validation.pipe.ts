// Pipe de validação de DTO usando Zod — decisão do Lote 6B.2: o projeto já
// tem `zod` instalado (ver package.json e config/env.validation.ts), então
// nenhuma segunda biblioteca de validação (`class-validator`/`class-
// transformer`) é adicionada. O `ValidationPipe` nativo do Nest só entende
// classes decoradas com `class-validator` — nunca é registrado aqui nem em
// nenhum outro lugar, para nunca existirem duas estratégias de validação
// concorrentes. Aplicado por endpoint (`@UsePipes(new ZodValidationPipe(schema))`
// ou `@Body(new ZodValidationPipe(schema))`) a partir do primeiro endpoint
// real (Lote 6B.3) — nenhum endpoint existe ainda neste lote.
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // Só o caminho de cada campo inválido, nunca o valor recebido — mesma
      // disciplina de `config/env.validation.ts` (nunca ecoar dado sensível
      // do request, ex.: senha, na mensagem de erro).
      const camposComProblema = [
        ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
      ];
      throw new BadRequestException(
        `Dados inválidos. Campos com problema: ${camposComProblema.join(', ')}.`,
      );
    }
    return result.data;
  }
}
