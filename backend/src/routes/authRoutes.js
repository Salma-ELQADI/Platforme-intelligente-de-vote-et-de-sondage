const express = require('express');
const router = express.Router();

const { register } = require('../controllers/authController');
const { validate, registerSchema } = require('../middlewares/validate');

// POST /api/auth/register
router.post('/register', validate(registerSchema), register);

module.exports = router;
