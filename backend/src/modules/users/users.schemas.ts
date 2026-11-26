import { z } from 'zod';
import { emailSchema, passwordSchema, usernameSchema } from '../auth/auth.schemas';

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    email: emailSchema.optional(),
    newPassword: passwordSchema.optional(),
    currentPassword: z.string().optional(),
  })
  .refine((d) => d.username || d.email || d.newPassword, { message: 'Aucune modification fournie' })
  .refine((d) => !(d.newPassword || d.email) || d.currentPassword, {
    path: ['currentPassword'],
    message: "Le mot de passe actuel est requis pour modifier l'email ou le mot de passe",
  });

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

export const adminUpdateUserSchema = z
  .object({
    role: z.enum(['user', 'admin']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => d.role !== undefined || d.isActive !== undefined, { message: 'Aucune modification fournie' });

export const lookupUserQuerySchema = z.object({
  identifier: z.string({ error: "Nom d'utilisateur ou email requis" }).trim().min(1, "Nom d'utilisateur ou email requis").max(255),
});
