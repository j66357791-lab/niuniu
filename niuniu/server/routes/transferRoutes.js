import { Router } from 'express'
import { transfer, getTransactions } from '../controllers/transferController.js'

const router = Router()

router.post('/transfer', transfer)
router.get('/transactions', getTransactions)

export default router
