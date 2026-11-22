const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isTokenRevoked } = require('./tokenBlocklist');

// JWT (Bearer) authentication middleware.
// - verifies the token is present and valid
// - rejects revoked (logged-out) tokens
// - loads the user from the database and ensures the account is active
// - attaches req.user and req.token for downstream handlers
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1].trim() : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise. Veuillez vous connecter.',
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const message =
        err.name === 'TokenExpiredError'
          ? 'Session expirée. Veuillez vous reconnecter.'
          : 'Jeton invalide. Veuillez vous reconnecter.';
      return res.status(401).json({ success: false, message });
    }

    if (isTokenRevoked(token)) {
      return res.status(401).json({
        success: false,
        message: 'Session invalide. Veuillez vous reconnecter.',
      });
    }

    const user = await User.findByPk(payload.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur introuvable. Veuillez vous reconnecter.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Votre compte est désactivé.',
      });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error('Erreur authenticate:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
    });
  }
};

module.exports = { authenticate };
