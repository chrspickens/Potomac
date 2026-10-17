declare module "node:crypto" { export function createHash(algorithm: string): { update(value: string): { digest(encoding: "hex"): string } }; }
