export interface ModuleEntitlementEntry {
  enabled: boolean;
  enabledAt?: Date;
  enabledBy?: string;
}

export type ModuleEntitlements = Record<string, ModuleEntitlementEntry>;
