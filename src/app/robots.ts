// robots.txt: orienta o rastreamento, não protege nada. As áreas privadas
// ficam fora da busca pelo `noindex` (src/lib/site/cabecalhos.ts) e pela
// sessão exigida pela API, não por aqui.
import type { MetadataRoute } from "next";
import { regrasDoRobots } from "@/lib/site/indexacao";
import { lerConfiguracaoDoSite } from "@/lib/site/origem-do-site";

export default function robots(): MetadataRoute.Robots {
  return regrasDoRobots(lerConfiguracaoDoSite(process.env));
}
