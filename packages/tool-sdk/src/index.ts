import { z } from "zod";

export const ToolRiskLevelSchema = z.enum(["R0", "R1", "R2", "R3"]);
export type ToolRiskLevel = z.infer<typeof ToolRiskLevelSchema>;

export const ToolManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  capabilities: z.array(z.string().min(1)),
  riskLevel: ToolRiskLevelSchema,
  timeoutMs: z.number().int().positive(),
  cancellable: z.boolean(),
  idempotent: z.boolean(),
  platforms: z.array(z.enum(["darwin", "win32", "linux"])),
  requiredSecretRefs: z.array(z.string().min(1))
});

export type ToolManifest = z.infer<typeof ToolManifestSchema>;
