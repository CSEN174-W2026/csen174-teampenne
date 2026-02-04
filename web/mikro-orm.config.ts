import "reflect-metadata";
import path from "path";
import { defineConfig } from "@mikro-orm/postgresql";
import { TsMorphMetadataProvider } from "@mikro-orm/reflection";

export default defineConfig({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  dbName: process.env.DB_NAME ?? "systems-manager",
  metadataProvider: TsMorphMetadataProvider,
  entities: [path.join(__dirname, "app/db/entities/**/*.js")],
  entitiesTs: [path.join(__dirname, "app/db/entities/**/*.ts")],
  migrations: {
    path: path.join(__dirname, "migrations"),
    glob: "!(*.d).{js,ts}",
  },
});
