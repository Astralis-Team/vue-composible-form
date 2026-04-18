import { ObjectSchema, ValidationError } from "yup";
import { Resolver, ResolverResult } from "../useForm";

export function yupResolver<TValues extends Record<string, any>>(
  schema: ObjectSchema<any>,
): Resolver<TValues> {
  return async (values): Promise<ResolverResult<TValues>> => {
    try {
      const data = await schema.validate(values, {
        abortEarly: false,
        stripUnknown: true,
      });

      return {
        values: data as TValues,
        errors: {},
      };
    } catch (err: any) {
      const errors: Record<string, { message: string }> = {};
      const yupError = err as ValidationError;

      if (yupError.inner) {
        yupError.inner.forEach((error) => {
          if (error.path && !errors[error.path]) {
            errors[error.path] = { message: error.message };
          }
        });
      }

      return {
        values: {},
        errors,
      };
    }
  };
}
