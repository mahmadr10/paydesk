import { JwtPayload } from "../utils/jwt";

// TypeScript doesn't know Express's Request type has a `.user` property -
// because it doesn't, by default. This file "augments" (extends) the
// existing Express type so `req.user` is recognized everywhere, with the
// right type, after our auth middleware sets it.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export {};
