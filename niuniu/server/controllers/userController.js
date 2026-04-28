import bcrypt from 'bcryptjs'
import User from '../models/User.js'

export async function register(req, res) {
  try {
    const { username, password, phone } = req.body
    if (!username || !password || !phone) return res.status(400).json({ ok: false, msg: '用户名、密码和手机号不能为空' })
    if (username.trim().length < 2) return res.status(400).json({ ok: false, msg: '用户名至少2个字符' })
    if (!/^1\d{10}$/.test(phone.trim())) return res.status(400).json({ ok: false, msg: '请输入正确的11位手机号' })
    const existing = await User.findOne({ $or: [{ username: username.trim() }, { phone: phone.trim() }] })
    if (existing) return res.status(409).json({ ok: false, msg: existing.username === username.trim() ? '用户名已存在' : '该手机号已被注册' })
    const salt = await bcrypt.genSalt(10)
    const user = await User.create({ username: username.trim(), password: await bcrypt.hash(password, salt), phone: phone.trim() })
    res.status(201).json({ ok: true, data: { id: user._id, username: user.username, phone: user.phone, role: user.role, score: user.score } })
  } catch (err) { console.error('注册异常:', err); res.status(500).json({ ok: false, msg: '服务器内部错误' }) }
}

export async function login(req, res) {
  try {
    const { account, password } = req.body
    if (!account || !password) return res.status(400).json({ ok: false, msg: '账号和密码不能为空' })
    const user = await User.findOne({ $or: [{ username: account.trim() }, { phone: account.trim() }] })
    if (!user) return res.status(401).json({ ok: false, msg: '账号不存在' })
    if (user.status === 'banned') return res.status(403).json({ ok: false, msg: '账号已被封禁' })
    if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ ok: false, msg: '密码错误' })
    res.json({ ok: true, data: { id: user._id, username: user.username, phone: user.phone, role: user.role, score: user.score } })
  } catch (err) { console.error('登录异常:', err); res.status(500).json({ ok: false, msg: '服务器内部错误' }) }
}
