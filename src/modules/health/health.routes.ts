import { Router } from 'express';
import { getDatabaseStatus } from '../../config/database';
import { sendSuccess } from '../../utils/apiResponse';

const router = Router();

router.get('/', (_req, res) => {
  const database = getDatabaseStatus();
  sendSuccess(res, 200, 'API is healthy', {
    status: 'UP',
    database,
  });
});

export default router;
