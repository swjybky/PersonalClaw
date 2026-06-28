export interface SqliteRuntimeBoundary {
  owner: "core";
  walRequired: true;
  migrationsRequired: true;
}

export const sqliteRuntimeBoundary: SqliteRuntimeBoundary = {
  owner: "core",
  walRequired: true,
  migrationsRequired: true
};
