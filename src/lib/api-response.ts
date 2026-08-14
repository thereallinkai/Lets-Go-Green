import { NextResponse } from "next/server";

export type ApiErrorAction = {
  kind: "retry" | "wait" | "navigate" | "edit" | "restart" | "contact_support";
  label: string;
  href?: string;
};

export type ApiError = {
  code: string;
  message: string;
  details?: string;
  action?: ApiErrorAction;
  retryable?: boolean;
  retryAfterSeconds?: number;
};

export type PublicErrorDefinition = ApiError & { status: number };
export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: ApiError };

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json<ApiResult<T>>({ data, error: null }, { status });
}

export function apiError(
  code: string,
  message: string,
  status = 400,
  options: Omit<ApiError, "code" | "message"> = {},
) {
  return NextResponse.json<ApiResult<never>>(
    { data: null, error: { code, message, ...options } },
    { status },
  );
}

export function publicError(definition: PublicErrorDefinition) {
  const { code, message, status, ...options } = definition;
  return apiError(code, message, status, options);
}
