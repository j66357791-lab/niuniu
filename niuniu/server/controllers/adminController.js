import User from '../models/User.js'
import Transaction from '../models/Transaction.js'

export async function getUsers(req, res) {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).lean()
    res.json({ ok: true, data: users })
  } catch (err) { res.status(500).json({ ok: false, msg: '查询失败' }) }
}

export async function toggleBan(req, res) {
  try {
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ ok: false, msg: '用户不存在' })
    if (user.role === 'admin') return res.status(403).json({ ok: false, msg: '无法封禁管理员' })
    const newStatus = user.status === 'normal' ? 'banned' : 'normal'
    await User.updateOne({ _id: req.params.id }, { $set: { status: newStatus } })
    res.json({ ok: true, msg: newStatus === 'banned' ? '已封禁' : '已解封' })
  } catch (err) { res.status(500).json({ ok: false, msg: '操作失败' }) }
}

export async function adjustScore(req, res) {
  const { amount, reason } = req.body
  if (!amount || !reason) return res.status(400).json({ ok: false, msg: '缺少调整数额或原因' })
  if (!Number.isInteger(amount)) return res.status(400).json({ ok: false, msg: '数额必须为整数' })

  const session = await User.startSession()
  session.startTransaction()
  try {
    const user = await User.findById(req.params.id).session(session)
    if (!user) { await session.abortTransaction(); return res.status(404).json({ ok: false, msg: '用户不存在' }) }
    if (user.score + amount < 0) { await session.abortTransaction(); return res.status(400).json({ ok: false, msg: '积分不足，无法扣减至负数' }) }

    await User.updateOne({ _id: req.params.id }, { $inc: { score: amount } }).session(session)
    await Transaction.create([{
      userId: user._id,
      type: amount > 0 ? 'sys_add' : 'sys_reduce',
      amount,
      balance_after: user.score + amount,
      description: `管理员操作：${reason}`
    }], { session })

    await session.commitTransaction()
    res.json({ ok: true, msg: '调整成功' })
  } catch (err) {
    await session.abortTransaction()
    res.status(500).json({ ok: false, msg: '调整失败' })
  } finally {
    session.endSession()
  }
}

export async function audit(req, res) {
  try {
    const scoreAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$score' } } }])
    const totalScore = scoreAgg.length > 0 ? scoreAgg[0].total : 0

    const txAgg = await Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
    const totalTx = txAgg.length > 0 ? txAgg[0].total : 0

    res.json({ ok: true, data: { totalScore, totalTx, diff: totalScore - totalTx } })
  } catch (err) { res.status(500).json({ ok: false, msg: '审计查询失败' }) }
}
