import { z } from 'zod';

export const usernameSchema = z
  .string({ error: "Le nom d'utilisateur est obligatoire" })
  .trim()
  .min(3, "Le nom d'utilisateur doit contenir au moins 3 caractères")
  .max(30, "Le nom d'utilisateur ne peut pas dépasser 30 caractères")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Le nom d'utilisateur ne peut contenir que des lettres, chiffres, '.', '-' et '_'");

export const emailSchema = z
  .string({ error: "L'email est obligatoire" })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Veuillez fournir un email valide' }).max(255));

export const passwordSchema = z
  .string({ error: 'Le mot de passe est obligatoire' })
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(72, 'Le mot de passe ne peut pas dépasser 72 caractères') // bcrypt only uses the first 72 bytes
  .regex(/[a-zA-Z]/, 'Le mot de passe doit contenir au moins une lettre')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre');

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: 'La confirmation du mot de passe est obligatoire' }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Les mots de passe ne correspondent pas',
  });

/**
 * Login with an email OR a username, in `identifier` (`email` is still
 * accepted for existing clients). Usernames cannot contain "@", so the two
 * are never ambiguous.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim().max(255).optional(),
    email: z.string().trim().max(255).optional(),
    password: z.string({ error: 'Le mot de passe est obligatoire' }).min(1, 'Le mot de passe est obligatoire'),
  })
  .transform(({ identifier, email, password }) => ({ identifier: identifier || email || '', password }))
  .refine((d) => d.identifier.length > 0, { path: ['identifier'], message: "L'email ou le nom d'utilisateur est obligatoire" });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
