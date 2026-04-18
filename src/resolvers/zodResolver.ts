import { ZodSchema } from "zod";
import { Resolver, ResolverResult } from "../useForm";

export function zodResolver<TValues extends Record<string, any>>(
  schema: ZodSchema<TValues>,
): Resolver<TValues> {
  return async (values): Promise<ResolverResult<TValues>> => {
    const result = schema.safeParse(values);

    if (result.success) {
      return {
        values: result.data,
        errors: {},
      };
    }
    const errors: Record<string, { message: string }> = {};

    result.error.issues.forEach((issue) => {
      const path = issue.path.join(".");

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
