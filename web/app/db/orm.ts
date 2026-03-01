import { MikroORM } from "@mikro-orm/postgresql";
import config from "../../mikro-orm.config";

let orm: MikroORM | null = null;

export async function getOrm() {
  if (!orm) orm = await MikroORM.init(config);
  return orm;
}
