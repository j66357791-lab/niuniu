import User from '../models/User.js'
import Transaction from '../models/Transaction.js'
import { getIO } from '../sockets/index.js'

export async function transfer(req, res) {
  const { fromUserId, toUsername, amount } = req.body
  if (!fromUserId || !toUsername || !amount) return res.status(400).json({ ok: false, msg: '参数不完整' })
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ ok: false, msg: '转增数额必须为正整数' })

  const session = await User.startSession()
  session.startTransaction()
  try {
    const fromUser = await User.findById(fromUserId).session(session)
    if (!fromUser) { await session.abortTransaction(); return res.status(404).json({ ok: false, msg: '转出账号异常' }) }
    if (fromUser.score < amount) { await session.abortTransaction(); return res.status(400).json({ ok: false, msg: '积分不足' }) }

    const toUser = await User.findOne({ username: toUsername.trim() }).session(session)
    if (!toUser) { await session.abortTransaction(); return res.status(404).json({ ok: false, msg: '目标用户不存在' }) }
    if (toUser.status === 'banned') { await session.abortTransaction(); return res.status(403).json({ ok: false, msg: '目标用户已被封禁' }) }
    if (fromUserId === toUser._id.toString()) { await session.abortTransaction(); return res.status(400).json({ ok: false, msg: '不能转给自己' }) }

    await User.updateOne({ _id: fromUserId }, { $inc: { score: -amount } }).session(session)
    await User.updateOne({ _id: toUser._id }, { $inc: { score: amount } }).session(session)

    await Transaction.insertMany([
      { userId: fromUserId, type: 'transfer_out', amount: -amount, balance_after: fromUser.score - amount, description: `转增给${toUser.username}` },
      { userId: toUser._id, type: 'transfer_in', amount: amount, balance_after: toUser.score + amount, description: `接收${fromUser.username}转增` }
    ], { session })

    await session.commitTransaction()
    
    // 事务成功后，通过 WS 个人频道精准推送最新积分给双方
    const io = getIO()
    if (io) {
      io.to(`user_${fromUserId}`).emit('score_sync', { newScore: fromUser.score - amount })
      io.to(`user_${toUser._id.toString()}`).emit('score_sync', { newScore: toUser.score + amount })
    }

    res.json({ ok: true, msg: '转增成功', data: { newScore: fromUser.score - amount } })
  } catch (err) {
    await session.abortTransaction()
    console.error('转增事务失败:', err)
    res.status(500).json({ ok: false, msg: '转增失败，服务器异常' })
  } finally {
    session.endSession()
  }
}

export async function getTransactions(req, res) {
  try {
    const { userId } = req.query
    if (!userId) return res.status(400).json({ ok: false, msg: '缺少用户ID' })
    const list = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(50).lean()
    res.json({ ok: true, data: list })
  } catch (err) { console.error('查询账单异常:', err); res.status(500).json({ ok: false, msg: '查询失败' }) }
}
