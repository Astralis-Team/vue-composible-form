export interface RuleObject<T = any> {
  value: T;
  message?: string | null;
}

export type ValidatorResult = boolean | string | undefined;
export type ValidatorFn = (
  value: any,
) => ValidatorResult | Promise<ValidatorResult>;

export interface FieldRules {
  default?: any;
  required?: boolean | string;
  minLength?: number | RuleObject<number>;
  maxLength?: number | RuleObject<number>;
  min?: number | RuleObject<number>;
  max?: number | RuleObject<number>;
  pattern?: RuleObject<RegExp>;
  validate?: ValidatorFn | Record<string, ValidatorFn>;
}

function normalizeRule<T>(rule: T | RuleObject<T>): RuleObject<T> {
  if (rule !== null && typeof rule === "object" && "value" in (rule as any)) {
    return rule as RuleObject<T>;
  }
  return { value: rule as T, message: null };
}

export async function runRules(
  value: any,
  rules: FieldRules,
): Promise<string | null> {
  const isEmpty = value === "" || value === null || value === undefined;

  if (rules.required) {
    if (isEmpty) {
      return typeof rules.required === "string"
        ? rules.required
        : "This field is required";
    }
  }

  if (isEmpty) return null;

  const str = String(value);
  const num = Number(value);

  if (rules.minLength !== undefined) {
    const { value: min, message } = normalizeRule(rules.minLength);
    if (str.length < min) return message ?? `Minimum ${min} characters`;
  }

  if (rules.maxLength !== undefined) {
    const { value: max, message } = normalizeRule(rules.maxLength);
    if (str.length > max) return message ?? `Maximum ${max} characters`;
  }

  if (rules.min !== undefined) {
    const { value: min, message } = normalizeRule(rules.min);
    if (isNaN(num) || num < min) return message ?? `Minimum value is ${min}`;
  }

  if (rules.max !== undefined) {
    const { value: max, message } = normalizeRule(rules.max);
    if (isNaN(num) || num > max) return message ?? `Maximum value is ${max}`;
  }

  if (rules.pattern) {
    const { value: regex, message } = normalizeRule(rules.pattern);
    if (!regex.test(str)) return message ?? "Invalid format";
  }

  if (rules.validate) {
    const validators: Record<string, ValidatorFn> =
      typeof rules.validate === "function"
        ? { _: rules.validate }
        : rules.validate;

    for (const fn of Object.values(validators)) {
      const result = await fn(value);
      if (result !== true && result !== undefined) {
        return typeof result === "string" ? result : "Invalid value";
      }
    }
  }

  return null;
}
