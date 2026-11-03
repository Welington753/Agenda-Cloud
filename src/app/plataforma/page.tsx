import { redirect } from "next/navigation";
import { ROTA_ESTABELECIMENTOS_ADMINISTRADOS } from "@/lib/administracao/rotas";

export default function AdministracaoPage() {
  redirect(ROTA_ESTABELECIMENTOS_ADMINISTRADOS);
}
