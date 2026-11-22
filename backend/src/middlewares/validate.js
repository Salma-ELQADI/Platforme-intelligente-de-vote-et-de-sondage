const Joi = require('joi');

const registerSchema = Joi.object({
  username: Joi.string().min(3).max(30).required().messages({
    'string.min': 'Le nom d\'utilisateur doit contenir au moins 3 caractères',
    'string.max': 'Le nom d\'utilisateur ne peut pas dépasser 30 caractères',
    'any.required': 'Le nom d\'utilisateur est obligatoire',
  }),
  email: Joi.string().email().required().messages({
    'string.email': 'Veuillez fournir un email valide',
    'any.required': 'L\'email est obligatoire',
  }),
  password: Joi.string().min(6).required().messages({
    'string.min': 'Le mot de passe doit contenir au moins 6 caractères',
    'any.required': 'Le mot de passe est obligatoire',
  }),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
    'any.only': 'Les mots de passe ne correspondent pas',
    'any.required': 'La confirmation du mot de passe est obligatoire',
  }),
});

// Login schema: accepts indifferently an "identifier" field (email or
// username), or — for compatibility with possibly existing forms — the "email"
// or "username" fields. At least one of the three is required.
const loginSchema = Joi.object({
  identifier: Joi.string().messages({
    'string.base': 'L\'identifiant doit être une chaîne de caractères',
    'string.empty': 'Veuillez fournir votre email ou nom d\'utilisateur',
  }),
  email: Joi.string().messages({
    'string.base': 'L\'email doit être une chaîne de caractères',
    'string.empty': 'Veuillez fournir votre email ou nom d\'utilisateur',
  }),
  username: Joi.string().messages({
    'string.base': 'Le nom d\'utilisateur doit être une chaîne de caractères',
    'string.empty': 'Veuillez fournir votre email ou nom d\'utilisateur',
  }),
  password: Joi.string().required().messages({
    'string.base': 'Le mot de passe est obligatoire',
    'string.empty': 'Le mot de passe est obligatoire',
    'any.required': 'Le mot de passe est obligatoire',
  }),
})
  .or('identifier', 'email', 'username')
  .messages({
    'object.missing': 'Veuillez fournir votre email ou nom d\'utilisateur',
  });

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({
      success: false,
      message: 'Erreur de validation',
      errors,
    });
  }

  next();
};

module.exports = { validate, registerSchema, loginSchema };
