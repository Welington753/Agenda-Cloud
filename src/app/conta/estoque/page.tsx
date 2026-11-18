// `/conta/estoque` sem página própria: leva a Produtos, a primeira da seção.
import { redirect } from "next/navigation";
import { ROTA_ESTOQUE_PRODUTOS } from "@/lib/conta/rotas";

export default function EstoquePage() {
  redirect(ROTA_ESTOQUE_PRODUTOS);
}
