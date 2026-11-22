const express = require('express');
const router = express.Router();

const { register, login, logout } = require('../controllers/authController');
const { validate, registerSchema, loginSchema } = require('../middlewares/validate');
const { authenticate } = require('../middlewares/authenticate');

// POST /api/auth/register
router.post('/register', validate(registerSchema), register);

// POST /api/auth/login
router.post('/login', validate(loginSchema), login);

// POST /api/auth/logout (authenticated: revokes the current session token)
router.post('/logout', authenticate, logout);

module.exports = router;
