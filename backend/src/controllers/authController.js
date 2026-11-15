const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const User = require('../models/User');

const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
};

const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.unscoped().findOne({
      where: {
        [Op.or]: [{ email }, { username }],
      },
    });

    if (existingUser) {
      const field = existingUser.email === email ? 'email' : 'username';
      const message =
        field === 'email'
          ? 'Cet email est déjà utilisé'
          : 'Ce nom d\'utilisateur est déjà pris';
      return res.status(409).json({
        success: false,
        message,
      });
    }

    const user = await User.create({ username, email, password });

    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      message: 'Inscription réussie',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Erreur register:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

module.exports = { register };
