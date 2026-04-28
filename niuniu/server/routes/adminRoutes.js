import { Router } from 'express'
import { requireAdmin } from '../middlewares/auth.js'
import { getUsers, toggleBan, adjustScore, audit } from '../controllers/adminController.js'

const router = Router()

router.get('/admin/users', requireAdmin, getUsers)
router.post('/admin/users/:id/ban', requireAdmin, toggleBan)
router.post('/admin/users/:id/adjust-score', requireAdmin, adjustScore)
router.get('/admin/audit', requireAdmin, audit)

export default router
