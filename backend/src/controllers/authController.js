const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const User = require('../models/User');
const { addTokenToBlocklist } = require('../middlewares/tokenBlocklist');

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

const login = async (req, res) => {
  try {
    const { identifier, email, username, password } = req.body;
    // Accept indifferently "identifier" (email or username) or, for
    // compatibility with existing forms, "email" / "username". One is enough.
    const loginIdentifier = identifier || email || username;

    // The password is excluded by the default scope, so we query without it.
    const user = await User.unscoped().findOne({
      where: {
        [Op.or]: [
          { email: loginIdentifier },
          { username: loginIdentifier },
        ],
      },
    });

    // Generic message to avoid revealing whether the identifier exists.
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Identifiants invalides',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Identifiants invalides',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Votre compte est désactivé. Contactez un administrateur.',
      });
    }

    const token = generateToken(user.id);

    res.status(200).json({
      success: true,
      message: 'Connexion réussie',
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
    console.error('Erreur login:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

const logout = async (req, res) => {
  try {
    const token = req.token;
    const decoded = jwt.decode(token);
    addTokenToBlocklist(token, decoded && decoded.exp);

    res.status(200).json({
      success: true,
      message: 'Déconnexion réussie',
    });
  } catch (error) {
    console.error('Erreur logout:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
    });
  }
};

module.exports = { register, login, logout };
