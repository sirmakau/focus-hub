import { Router } from 'express';
import { handleTelegramUpdate } from '../controllers/telegram.controller.js';
import { webhookAuth } from '../middleware/webhook-auth.js';

const router = Router();

router.post('/webhook', webhookAuth, handleTelegramUpdate);

export default router;
