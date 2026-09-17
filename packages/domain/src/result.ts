/** Expected failures are values, not exceptions (BUILD_SPEC §15). */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** The single error shape the API maps to HTTP (BUILD_SPEC §6.4). */
export type DomainError = {
  readonly code: string;
  readonly message: string;
  readonly current_state?: string;
  readonly detail?: Record<string, unknown>;
};
