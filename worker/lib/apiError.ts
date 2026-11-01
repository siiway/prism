// API errors are stable codes, never English sentences. Responses look like
// `{ error: "field_required", params: { field: "name" } }`; the client
// translates the code from apiErrors.<code> in its own language and fills the
// placeholders from params. tests/api-error-codes.test.ts holds every route
// to this, and checks each code has a translation.

export type ErrorParams = Record<string, string | number>;

/** A failure a helper hands back to its route, ready for c.json(). */
export interface CodedError {
  error: string;
  params?: ErrorParams;
}
