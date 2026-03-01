import "reflect-metadata";
import path from "path";
import { defineConfig } from "@mikro-orm/postgresql";
import { ReflectMetadataProvider } from "@mikro-orm/core";
import { VmInfo } from "./app/db/entities/VmInfo";
import { DistributedManagerIteration } from "./app/db/entities/DistributedManagerIteration";
import { NodeMetricSample } from "./app/db/entities/NodeMetricSample";

export default defineConfig({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  dbName: process.env.DB_NAME ?? "systems-manager",
  metadataProvider: ReflectMetadataProvider,
  // Explicit class registration is reliable in Next runtime.
  entities: [VmInfo, DistributedManagerIteration, NodeMetricSample],
  entitiesTs: [VmInfo, DistributedManagerIteration, NodeMetricSample],
  migrations: {
    path: path.join(__dirname, "migrations"),
    glob: "!(*.d).{js,ts}",
  },
});
