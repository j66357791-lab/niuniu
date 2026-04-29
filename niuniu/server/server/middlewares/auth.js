import User from '../models/User.js'

export async function requireAdmin(req, res, next) {
  const adminId = req.body.adminUserId || req.query.adminUserId
  if (!adminId) return res.status(401).json({ ok: false, msg: '未授权' })
  try {
    const user = await User.findById(adminId)
    if (!user || user.role !== 'admin') return res.status(403).json({ ok: false, msg: '无管理员权限' })
    next()
  } catch { res.status(500).json({ ok: false, msg: '鉴权异常' }) }
}
