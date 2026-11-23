import type { PublicUser } from '../modules/users/users.types';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export {};
