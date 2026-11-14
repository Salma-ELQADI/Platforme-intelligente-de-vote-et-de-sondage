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

module.exports = { validate, registerSchema };
