/** Local development defaults match docker-compose.yml (D-009). Never a real secret. */
export const dbConfig = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5434),
  user: process.env.PGUSER ?? "pmp",
  password: process.env.PGPASSWORD ?? "pmp_dev",
  database: process.env.PGDATABASE ?? "pmp_dev",
} as const;
