// AI segéd (Gemini alapú) – POST /ai/chat
// Egyszerű request/response chat. A history mezőt a kliens tárolja,
// és minden új üzenetnél újra elküldi.
const express = require('express');
const { authRequired } = require('../middleware/auth');
const { supportChat } = require('../services/gemini');
const { aiChatRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Percenként max 20 üzenetet küldhet egy user — elegendő normál
// használathoz és védi a Gemini kvótát a botoktól.
router.post('/ai/chat', authRequired, aiChatRateLimit, async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Hiányzó üzenet' });
  }
  const reply = await supportChat(message, Array.isArray(history) ? history : []);
  res.json(reply);
});

module.exports = router;
