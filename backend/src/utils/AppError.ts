// A custom error type so we can throw errors anywhere in the app (services,
// controllers, middleware) and have ONE place turn them into a consistent
// JSON response - instead of every route handler writing its own res.status().json(...).
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    // Restores the correct prototype chain (needed when extending built-in
    // classes like Error in TypeScript compiled to older JS targets)
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
