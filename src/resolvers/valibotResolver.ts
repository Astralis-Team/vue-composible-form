import { safeParseAsync, type BaseSchema, type BaseSchemaAsync } from "valibot";
import { Resolver, ResolverResult } from "../useForm";

export function valibotResolver<TValues extends Record<string, any>>(
  schema: BaseSchema<any, any, any> | BaseSchemaAsync<any, any, any>,
): Resolver<TValues> {
  return async (values): Promise<ResolverResult<TValues>> => {
    const result = await safeParseAsync(schema, values);

    if (result.success) {
      return {
        values: result.output as TValues,
        errors: {},
      };
    }

    const errors: Record<string, { message: string }> = {};

    result.issues.forEach((issue) => {
      const path = issue.path?.map((p: any) => p.key).join(".") || "_form";

      if (!errors[path]) {
        errors[path] = { message: issue.message };
      }
    });

    return {
      values: {},
      errors,
    };
  };
}
