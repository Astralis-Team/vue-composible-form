import {
  reactive,
  computed,
  readonly,
  provide,
  inject,
  InjectionKey,
  Ref,
  WritableComputedRef,
  DeepReadonly,
} from "vue";
import { get, set, unset, flatKeys } from "./utils";
import { runRules, FieldRules } from "./validation";

export type ValidationMode =
  | "onSubmit"
  | "onBlur"
  | "onChange"
  | "onTouched"
  | "all";

export interface ResolverResult<TValues> {
  values: TValues | {};
  errors: Record<string, { message: string }>;
}

export type Resolver<TValues> = (
  values: TValues,
) => Promise<ResolverResult<TValues>>;

export interface UseFormOptions<TValues extends Record<string, any>> {
  fields?: Record<string, FieldRules>;
  defaults?: Partial<TValues>;
  mode?: ValidationMode;
  resolver?: Resolver<TValues> | null;
}

export interface FormMeta {
  isSubmitting: boolean;
  isSubmitted: boolean;
  submitCount: number;
  isValid: boolean;
  isDirty: boolean;
}

export interface FieldDescriptor {
  model: WritableComputedRef<any>;
  readonly value: any;
  error: Ref<string | null>;
  readonly touched: boolean;
  readonly dirty: boolean;
  attrs: { onBlur: () => void };
}

export interface UseFormReturn<TValues extends Record<string, any>> {
  fields: Record<string, FieldDescriptor>;
  formState: DeepReadonly<FormMeta>;
  handleSubmit: (
    onValid: (values: TValues) => Promise<void> | void,
    onInvalid?: (errors: Record<string, string>) => void,
  ) => (event?: Event) => Promise<void>;
  reset: (newValues?: Partial<TValues>) => void;
  setError: (name: string, message: string) => void;
  clearErrors: (name?: string) => void;
  setValue: (name: string, value: any) => void;
  getValue: (name?: string) => any;
}

const FORM_KEY: InjectionKey<UseFormReturn<any>> = Symbol("useForm");

export function useForm<
  TValues extends Record<string, any> = Record<string, any>,
>(options: UseFormOptions<TValues> = {}): UseFormReturn<TValues> {
  const {
    fields: schema = {},
    defaults = {},
    mode = "onSubmit",
    resolver = null,
  } = options;

  const _values = reactive<Record<string, any>>({});
  const _errors = reactive<Record<string, string>>({});
  const _touched = reactive<Record<string, boolean>>({});
  const _dirty = reactive<Record<string, boolean>>({});

  const _meta = reactive<FormMeta>({
    isSubmitting: false,
    isSubmitted: false,
    submitCount: 0,
    isValid: true,
    isDirty: false,
  });

  for (const [name, rules] of Object.entries(schema)) {
    const defaultVal =
      (defaults as Record<string, any>)[name] ?? rules.default ?? "";
    set(_values, name, defaultVal);
  }

  const _defaultValues = JSON.parse(JSON.stringify(_values));

  async function validate(
    name: string,
    rules: FieldRules,
    value: any,
  ): Promise<boolean> {
    let error: string | null = null;

    if (resolver) {
      const result = await resolver({
        ...JSON.parse(JSON.stringify(_values)),
        [name]: value,
      });
      error = result.errors?.[name]?.message ?? null;
    } else {
      error = await runRules(value, rules);
    }

    if (error) {
      set(_errors, name, error);
    } else {
      unset(_errors, name);
    }

    _meta.isValid = flatKeys(_errors).length === 0;
    return !error;
  }

  async function validateAll(): Promise<boolean> {
    if (resolver) {
      const result = await resolver(JSON.parse(JSON.stringify(_values)));

      for (const key of flatKeys(_errors)) unset(_errors, key);

      for (const [name, err] of Object.entries(result.errors ?? {})) {
        set(_errors, name, err.message);
      }

      const errorCount = Object.keys(result.errors ?? {}).length;
      _meta.isValid = errorCount === 0;
      return _meta.isValid;
    }

    const results = await Promise.all(
      Object.entries(schema).map(([name, rules]) =>
        validate(name, rules, get(_values, name)),
      ),
    );

    return results.every(Boolean);
  }

  const fields = Object.fromEntries(
    Object.entries(schema).map(([name, rules]) => {
      const model = computed({
        get: () => get(_values, name),
        set: (val) => {
          set(_values, name, val);
          const isFieldDirty =
            JSON.stringify(val) !== JSON.stringify(get(_defaultValues, name));
          set(_dirty, name, isFieldDirty);
          _meta.isDirty = flatKeys(_dirty).some((k) => get(_dirty, k));

          if (
            mode === "onChange" ||
            mode === "all" ||
            (_meta.isSubmitted && mode === "onSubmit")
          ) {
            validate(name, rules, val);
          }
        },
      });

      function onBlur() {
        set(_touched, name, true);
        if (mode === "onBlur" || mode === "onTouched" || mode === "all") {
          validate(name, rules, get(_values, name));
        }
      }

      const descriptor: FieldDescriptor = {
        model,
        get value() {
          return get(_values, name);
        },
        error: computed(() => get(_errors, name) ?? null),
        get touched() {
          return get(_touched, name) ?? false;
        },
        get dirty() {
          return get(_dirty, name) ?? false;
        },
        attrs: { onBlur },
      };

      return [name, descriptor];
    }),
  );

  function handleSubmit(
    onValid: (values: TValues) => Promise<void> | void,
    onInvalid?: (errors: Record<string, string>) => void,
  ) {
    return async (event?: Event) => {
      event?.preventDefault?.();

      _meta.isSubmitting = true;
      _meta.isSubmitted = true;
      _meta.submitCount++;

      try {
        const valid = await validateAll();

        if (valid) {
          await onValid(JSON.parse(JSON.stringify(_values)));
        } else {
          onInvalid?.({ ...JSON.parse(JSON.stringify(_errors)) });
        }
      } finally {
        _meta.isSubmitting = false;
      }
    };
  }

  function reset(newValues?: Partial<TValues>) {
    const source = newValues ?? _defaultValues;

    for (const name of Object.keys(schema)) {
      const val = get(source, name) ?? get(_defaultValues, name) ?? "";
      set(_values, name, val);
      unset(_errors, name);
      unset(_touched, name);
      unset(_dirty, name);
    }

    _meta.isSubmitting = false;
    _meta.isSubmitted = false;
    _meta.isValid = true;
    _meta.isDirty = false;
  }

  function setError(name: string, message: string) {
    set(_errors, name, message);
    _meta.isValid = false;
  }

  function clearErrors(name?: string) {
    if (name) {
      unset(_errors, name);
    } else {
      for (const key of flatKeys(_errors)) unset(_errors, key);
    }
    _meta.isValid = flatKeys(_errors).length === 0;
  }

  function setValue(name: string, value: any) {
    if (fields[name]) {
      fields[name].model.value = value;
    }
  }

  function getValue(name?: string): any {
    if (name) return get(_values, name);
    return JSON.parse(JSON.stringify(_values));
  }

  const formState = readonly(_meta);

  const contextData: UseFormReturn<TValues> = {
    fields,
    formState,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    setValue,
    getValue,
  };

  provide(FORM_KEY, contextData);

  return contextData;
}

export function useFormContext<
  TValues extends Record<string, any> = Record<string, any>,
>(): UseFormReturn<TValues> {
  const ctx = inject(FORM_KEY);

  if (!ctx) {
    throw new Error(
      "[useForm] useFormContext() was called outside of a form context.",
    );
  }

  return ctx as UseFormReturn<TValues>;
}

export function useField(name: string): FieldDescriptor {
  const { fields } = useFormContext();

  if (!fields[name]) {
    throw new Error(`[useForm] useField() could not find field "${name}".`);
  }

  return fields[name];
}
