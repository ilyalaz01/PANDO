export interface ContractViolation {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly valid: true; readonly violations: readonly [] }
  | { readonly valid: false; readonly violations: readonly ContractViolation[] };

export function validationResult(violations: readonly ContractViolation[]): ValidationResult {
  return violations.length === 0 ? { valid: true, violations: [] } : { valid: false, violations };
}
