import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { createServer } from 'http'
import { Server } from 'socket.io'
import User from './models/User.js'
import Transaction from './models/Transaction.js'

const app = express()
const httpServer = createServer(app)
app.use(express.json())
app.use(require('cors')({ origin: '*', credentials: true })) 

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/niuniu';
mongoose
  .connect(mongoURI)
  .then(async () => {
    console.log('✅ MongoDB 连接成功')
    await initAdmin()
  })
  .catch((err) => {
    console.error('❌ MongoDB 连接失败:', err.message)
    process.exit(1)
  })

// ==================== 前置任务：初始化默认管理员 ====================
async function initAdmin() {
  try {
    const admin = await User.findOne({ role: 'admin' })
    if (!admin) {
      const hash = await bcrypt.hash('628727', 10)
      await User.create({
        username: '18679012034',
        phone: '18679012034',
        password: hash,
        role: 'admin',
        score: 0
      })
      console.log('🛡️ 默认管理员已初始化 (账号/手机: 18679012034)')
    }
  } catch (err) {
    console.error('初始化管理员失败:', err)
  }
}

// ==================== API 路由 ====================

app.post('/api/register', async (req, res) => {
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
})

app.post('/api/login', async (req, res) => {
  try {
    const { account, password } = req.body
    if (!account || !password) return res.status(400).json({ ok: false, msg: '账号和密码不能为空' })
    const user = await User.findOne({ $or: [{ username: account.trim() }, { phone: account.trim() }] })
    if (!user) return res.status(401).json({ ok: false, msg: '账号不存在' })
    if (user.status === 'banned') return res.status(403).json({ ok: false, msg: '账号已被封禁' })
    if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ ok: false, msg: '密码错误' })
    res.json({ ok: true, data: { id: user._id, username: user.username, phone: user.phone, role: user.role, score: user.score } })
  } catch (err) { console.error('登录异常:', err); res.status(500).json({ ok: false, msg: '服务器内部错误' }) }
})

app.post('/api/transfer', async (req, res) => {
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
    res.json({ ok: true, msg: '转增成功', data: { newScore: fromUser.score - amount } })
  } catch (err) {
    await session.abortTransaction()
    console.error('转增事务失败:', err)
    res.status(500).json({ ok: false, msg: '转增失败，服务器异常' })
  } finally {
    session.endSession()
  }
})

app.get('/api/transactions', async (req, res) => {
  try {
    const { userId } = req.query
    if (!userId) return res.status(400).json({ ok: false, msg: '缺少用户ID' })
    const list = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(50).lean()
    res.json({ ok: true, data: list })
  } catch (err) { console.error('查询账单异常:', err); res.status(500).json({ ok: false, msg: '查询失败' }) }
})

// ==================== 管理员接口 ====================

async function requireAdmin(req, res, next) {
  const adminId = req.body.adminUserId || req.query.adminUserId
  if (!adminId) return res.status(401).json({ ok: false, msg: '未授权' })
  try {
    const user = await User.findById(adminId)
    if (!user || user.role !== 'admin') return res.status(403).json({ ok: false, msg: '无管理员权限' })
    next()
  } catch { res.status(500).json({ ok: false, msg: '鉴权异常' }) }
}

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).lean()
    res.json({ ok: true, data: users })
  } catch (err) { res.status(500).json({ ok: false, msg: '查询失败' }) }
})

app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ ok: false, msg: '用户不存在' })
    if (user.role === 'admin') return res.status(403).json({ ok: false, msg: '无法封禁管理员' })
    const newStatus = user.status === 'normal' ? 'banned' : 'normal'
    await User.updateOne({ _id: req.params.id }, { $set: { status: newStatus } })
    res.json({ ok: true, msg: newStatus === 'banned' ? '已封禁' : '已解封' })
  } catch (err) { res.status(500).json({ ok: false, msg: '操作失败' }) }
})

app.post('/api/admin/users/:id/adjust-score', requireAdmin, async (req, res) => {
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
})

app.get('/api/admin/audit', requireAdmin, async (req, res) => {
  try {
    const scoreAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$score' } } }])
    const totalScore = scoreAgg.length > 0 ? scoreAgg[0].total : 0

    const txAgg = await Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
    const totalTx = txAgg.length > 0 ? txAgg[0].total : 0

    res.json({ ok: true, data: { totalScore, totalTx, diff: totalScore - totalTx } })
  } catch (err) { res.status(500).json({ ok: false, msg: '审计查询失败' }) }
})

app.get('/', (_req, res) => res.send('牛牛服务器运行中...'))

// ==================== Socket.io ====================
const io = new Server(httpServer, {
  cors: { origin: '*', credentials: true }
})

const playerStatusMap = new Map()
const rooms = new Map()

function formatRoomUpdate(room) {
  return {
    roomId: room.roomId, ownerId: room.ownerId, phase: room.phase, bankerId: room.bankerId,
    players: Array.from(room.players.values()).map(p => ({ userId: p.userId, username: p.username, isReady: p.isReady, offline: !!p.offline }))
  }
}
function findUserRoom(userId) { for (const room of rooms.values()) { if (room.players.has(userId)) return room } return null }
function clearAllTimers(room) {
  if (room.countdownTimer) { clearInterval(room.countdownTimer); room.countdownTimer = null }
  if (room.robAnimTimer) { clearTimeout(room.robAnimTimer); room.robAnimTimer = null }
  if (room.dealTimer) { clearTimeout(room.dealTimer); room.dealTimer = null }
  if (room.settleTimer) { clearTimeout(room.settleTimer); room.settleTimer = null }
}
function removeUserFromRoom(room, userId) {
  room.players.delete(userId); playerStatusMap.set(userId, 'idle')
  if (room.players.size === 0) { clearAllTimers(room); rooms.delete(room.roomId); return }
  if (room.ownerId === userId) room.ownerId = room.players.values().next().value.userId
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
}

function createDeck() { const s = ['hearts', 'diamonds', 'clubs', 'spades'], v = ['A','02','03','04','05','06','07','08','09','10','J','Q','K'], d=[]; for (const su of s) for (const va of v) d.push(`${su}_${va}`); return d }
function shuffle(arr) { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a }
function getCardPoint(c) { const v=c.split('_')[1]; if(v==='A')return 1; if(['J','Q','K'].includes(v))return 10; return parseInt(v) }
function calculateBull(hand) {
  for(let i=0;i<5;i++) for(let j=i+1;j<5;j++) for(let k=j+1;k<5;k++) {
    if((getCardPoint(hand[i])+getCardPoint(hand[j])+getCardPoint(hand[k]))%10===0) {
      const r=[]; for(let m=0;m<5;m++) if(m!==i&&m!==j&&m!==k) r.push(hand[m]); const s=(getCardPoint(r[0])+getCardPoint(r[1]))%10; return s===0?'bull_bull':`bull_${s}`
    }
  } return 'no_bull'
}
function bullRank(r) { return r==='bull_bull'?10:r==='no_bull'?0:parseInt(r.split('_')[1]) }
function getMultiplier(r) { return r==='bull_bull'?3:bullRank(r)>=7?2:1 }

function calculateGameResults(room) {
  const banker = room.players.get(room.bankerId), bRank = bullRank(banker.bullResult), results = []; let bankerDelta = 0
  for (const [uid, p] of room.players) {
    if (uid === room.bankerId) { results.push({ userId: uid, username: p.username, hand: p.hand, bullResult: p.bullResult, scoreChange: 0, isBanker: true, newTotal: p.roundScore }); continue }
    const mult = Math.max(getMultiplier(p.bullResult), getMultiplier(banker.bullResult))
    let change = bullRank(p.bullResult) > bRank ? room.baseScore * mult : -room.baseScore * mult
    if (change < 0 && Math.abs(change) > p.roundScore) change = -p.roundScore
    bankerDelta -= change
    results.push({ userId: uid, username: p.username, hand: p.hand, bullResult: p.bullResult, scoreChange: change, isBanker: false, newTotal: p.roundScore + change })
  }
  const br = results.find(r => r.isBanker); let bChange = bankerDelta
  if (bChange < 0 && Math.abs(bChange) > banker.roundScore) bChange = -banker.roundScore
  br.scoreChange = bChange; br.newTotal = banker.roundScore + bChange; return results
}

function startCountdown(room, seconds, phase, onEnd) { clearCountdown(room); room.countdownSeconds=seconds; io.to(`room_${room.roomId}`).emit('countdown',{seconds,phase}); room.countdownTimer=setInterval(()=>{room.countdownSeconds--;io.to(`room_${room.roomId}`).emit('countdown',{seconds:room.countdownSeconds,phase});if(room.countdownSeconds<=0){clearCountdown(room);onEnd()}},1000) }
function clearCountdown(room) { if(room.countdownTimer){clearInterval(room.countdownTimer);room.countdownTimer=null} }

function startRobbing(room) {
  room.phase='robbing'; room.robbers=[]
  for(const p of room.players.values()){p.hasRobbed=false;p.wantsRob=false;p.hand=[];p.bullResult='';p.hasShownDown=false;p.roundScore=p.score;playerStatusMap.set(p.userId,'in_game')}
  room.deck=shuffle(createDeck()); let idx=0; for(const p of room.players.values()){p.hand=room.deck.slice(idx,idx+5);idx+=5}
  const pub=[]; for(const[uid,p]of room.players) pub.push({userId:uid,publicCards:p.hand.slice(0,3)})
  io.to(`room_${room.roomId}`).emit('deal_cards',{players:pub})
  for(const p of room.players.values()) io.to(p.socketId).emit('deal_cards_private',{privateCards:p.hand.slice(3)})
  io.to(`room_${room.roomId}`).emit('phase_changed',{phase:'robbing'}); startCountdown(room,15,'robbing',()=>finishRobbing(room))
}
function finishRobbing(room) {
  if(!rooms.has(room.roomId)||room.phase!=='robbing')return
  for(const p of room.players.values()) if(!p.hasRobbed) p.wantsRob=false
  const rob=[]; for(const[uid,p]of room.players) if(p.wantsRob) rob.push(uid); room.robbers=rob
  if(rob.length===0) selectBanker(room,Array.from(room.players.keys())[Math.floor(Math.random()*room.players.size)])
  else if(rob.length===1) selectBanker(room,rob[0])
  else startRobAnimation(room,rob)
}
function selectBanker(room, bankerId) {
  room.bankerId=bankerId; room.phase='banker_confirmed'
  io.to(`room_${room.roomId}`).emit('phase_changed',{phase:'banker_confirmed',bankerId,robbers:room.robbers})
  room.dealTimer=setTimeout(()=>{room.dealTimer=null;if(!rooms.has(room.roomId))return;startPlaying(room)},1000)
}
function startRobAnimation(room, robbers) {
  room.phase='rob_animating'; io.to(`room_${room.roomId}`).emit('phase_changed',{phase:'rob_animating',robbers})
  room.robAnimTimer=setTimeout(()=>{room.robAnimTimer=null;if(!rooms.has(room.roomId)||room.phase!=='rob_animating')return;selectBanker(room,robbers[Math.floor(Math.random()*robbers.length)])},5000)
}
function startPlaying(room) {
  room.phase='playing'; io.to(`room_${room.roomId}`).emit('phase_changed',{phase:'playing'})
  for(const[uid,p]of room.players){if(uid!==room.bankerId&&p.offline&&!p.hasShownDown){p.hasShownDown=true;p.bullResult=calculateBull(p.hand);io.to(`room_${room.roomId}`).emit('player_showdown',{userId:uid,privateCards:p.hand.slice(3),bullResult:p.bullResult})}}
  if(allPeasantsShown(room)) startBankerPlaying(room)
  else startCountdown(room,15,'playing',()=>{if(!rooms.has(room.roomId)||room.phase!=='playing')return;forceShowPeasants(room)})
}
function handleShowdown(room, userId) {
  const p=room.players.get(userId); if(!p||p.hasShownDown||p.offline)return
  if(room.phase==='playing'&&userId===room.bankerId)return; if(room.phase==='banker_playing'&&userId!==room.bankerId)return
  p.hasShownDown=true;p.bullResult=calculateBull(p.hand);io.to(`room_${room.roomId}`).emit('player_showdown',{userId,privateCards:p.hand.slice(3),bullResult:p.bullResult})
  if(room.phase==='playing'){if(allPeasantsShown(room)){clearCountdown(room);startBankerPlaying(room)}}
  else if(room.phase==='banker_playing'){if(allPlayersShown(room)){clearCountdown(room);settleGame(room)}}
}
function allPeasantsShown(r){for(const[uid,p]of r.players){if(uid!==r.bankerId&&!p.hasShownDown)return false}return true}
function allPlayersShown(r){return Array.from(r.players.values()).every(p=>p.hasShownDown)}
function forceShowPeasants(room){for(const[uid,p]of room.players){if(uid===room.bankerId||p.hasShownDown)continue;p.hasShownDown=true;p.bullResult=calculateBull(p.hand);io.to(`room_${room.roomId}`).emit('player_showdown',{userId:uid,privateCards:p.hand.slice(3),bullResult:p.bullResult})}startBankerPlaying(room)}
function startBankerPlaying(room) {
  room.phase='banker_playing'; io.to(`room_${room.roomId}`).emit('phase_changed',{phase:'banker_playing'})
  const b=room.players.get(room.bankerId)
  if(b&&b.offline&&!b.hasShownDown){b.hasShownDown=true;b.bullResult=calculateBull(b.hand);io.to(`room_${room.roomId}`).emit('player_showdown',{userId:room.bankerId,privateCards:b.hand.slice(3),bullResult:b.bullResult});settleGame(room)}
  else startCountdown(room,5,'banker_playing',()=>{if(!rooms.has(room.roomId)||room.phase!=='banker_playing')return;forceBankerShowdown(room)})
}
function forceBankerShowdown(room){const b=room.players.get(room.bankerId);if(b&&!b.hasShownDown){b.hasShownDown=true;b.bullResult=calculateBull(b.hand);io.to(`room_${room.roomId}`).emit('player_showdown',{userId:room.bankerId,privateCards:b.hand.slice(3),bullResult:b.bullResult})}settleGame(room)}

async function settleGame(room) {
  room.phase='settling'; const results=calculateGameResults(room)
  try {
    const bulkOps=results.map(r=>({updateOne:{filter:{_id:r.userId},update:{$inc:{score:r.scoreChange}}}}))
    const txDocs=results.map(r=>({userId:r.userId,type:r.scoreChange>=0?'game_win':'game_lose',amount:r.scoreChange,balance_after:r.newTotal,description:r.scoreChange>=0?'牛牛对局胜利':'牛牛对局失败'}))
    await Promise.all([User.bulkWrite(bulkOps),Transaction.insertMany(txDocs)]); console.log(`💰 房间 ${room.roomId} 积分结算完成`)
  } catch(err){console.error('结算异常:',err)}
  io.to(`room_${room.roomId}`).emit('game_result',{results})
  room.settleTimer=setTimeout(()=>{room.settleTimer=null;if(rooms.has(room.roomId)){resetRoom(room);console.log(`🔄 房间 ${room.roomId} 重置`)}},10000)
}

function resetRoom(room) {
  clearAllTimers(room); room.phase='waiting'; room.deck=[]; room.bankerId=''; room.robbers=[]
  const toRemove=[]
  for(const[uid,p]of room.players){if(p.offline)toRemove.push(uid);else{p.hand=[];p.bullResult='';p.isReady=false;p.hasShownDown=false;p.hasRobbed=false;p.wantsRob=false;p.offline=false;p.roundScore=0}}
  for(const uid of toRemove){room.players.delete(uid);playerStatusMap.set(uid,'idle')}
  for(const[uid]of room.players) playerStatusMap.set(uid,'idle')
  if(room.players.size===0){rooms.delete(room.roomId);return}
  if(!room.players.has(room.ownerId))room.ownerId=room.players.values().next().value.userId
  io.to(`room_${room.roomId}`).emit('phase_changed',{phase:'waiting'}); io.to(`room_${room.roomId}`).emit('room_update',formatRoomUpdate(room))
}

function sendFullGameState(socket, room, userId) {
  socket.emit('room_update',formatRoomUpdate(room)); if(room.phase!=='waiting')socket.emit('phase_changed',{phase:room.phase,bankerId:room.bankerId,robbers:room.robbers})
  if(room.deck.length>0){const pub=[];for(const[uid,p]of room.players)pub.push({userId:uid,publicCards:p.hand.slice(0,3)});socket.emit('deal_cards',{players:pub});const me=room.players.get(userId);if(me)socket.emit('deal_cards_private',{privateCards:me.hand.slice(3)});for(const[uid,p]of room.players)if(p.hasShownDown)socket.emit('player_showdown',{userId:uid,privateCards:p.hand.slice(3),bullResult:p.bullResult})}
  for(const[uid,p]of room.players)if(p.hasRobbed)socket.emit('rob_choice_made',{userId:uid,wantsRob:p.wantsRob})
  if(room.countdownSeconds>0)socket.emit('countdown',{seconds:room.countdownSeconds,phase:room.phase})
}

io.on('connection', (socket) => {
  socket.on('auth', ({ userId, username }) => { socket.data.userId=userId; socket.data.username=username; if(!playerStatusMap.has(userId))playerStatusMap.set(userId,'idle') })
  
  socket.on('create_room', async ({ password }, callback) => {
    const userId=socket.data.userId, username=socket.data.username; if(!userId)return callback?.({ok:false,msg:'未认证'})
    if(!password||password.length<4)return callback?.({ok:false,msg:'密码至少4位'})
    if(playerStatusMap.get(userId)==='in_game')return callback?.({ok:false,msg:'您在其他房间有未结束的对局，请等待结算'})
    let score=0; try{const u=await User.findById(userId).select('score').lean();if(u)score=u.score}catch{}
    if(score<100)return callback?.({ok:false,msg:'积分不足100，无法创建房间'})
    const prev=findUserRoom(userId);if(prev){socket.leave(`room_${prev.roomId}`);removeUserFromRoom(prev,userId)}
    let roomId; do{roomId=String(Math.floor(1000+Math.random()*9000))}while(rooms.has(roomId))
    const room={roomId,password,ownerId:userId,phase:'waiting',deck:[],bankerId:'',baseScore:10,robbers:[],countdownTimer:null,robAnimTimer:null,dealTimer:null,settleTimer:null,countdownSeconds:0,players:new Map([[userId,{userId,username,socketId:socket.id,isReady:false,hasRobbed:false,wantsRob:false,hand:[],bullResult:'',hasShownDown:false,offline:false,roundScore:0,score}]])}
    rooms.set(roomId,room);socket.join(`room_${roomId}`);console.log(`🏠 房间 ${roomId} 已创建`);callback?.({ok:true,roomId})
  })

  socket.on('join_room', async ({ roomId, password }, callback) => {
    const userId=socket.data.userId, username=socket.data.username; if(!userId)return callback?.({ok:false,msg:'未认证'})
    if(playerStatusMap.get(userId)==='in_game')return callback?.({ok:false,msg:'您在其他房间有未结束的对局，请等待结算'})
    const room=rooms.get(roomId); if(!room)return callback?.({ok:false,msg:'房间不存在'})
    if(room.players.has(userId)){callback?.({ok:true});sendFullGameState(socket,room,userId);return}
    if(room.password!==password)return callback?.({ok:false,msg:'房间密码错误'})
    if(room.players.size>=4)return callback?.({ok:false,msg:'房间已满'})
    if(room.phase!=='waiting')return callback?.({ok:false,msg:'游戏进行中，无法加入'})
    let score=0; try{const u=await User.findById(userId).select('score').lean();if(u)score=u.score}catch{}
    if(score<100)return callback?.({ok:false,msg:'积分不足100，无法加入该房间'})
    const prev=findUserRoom(userId);if(prev){socket.leave(`room_${prev.roomId}`);removeUserFromRoom(prev,userId)}
    room.players.set(userId,{userId,username,socketId:socket.id,isReady:false,hasRobbed:false,wantsRob:false,hand:[],bullResult:'',hasShownDown:false,offline:false,roundScore:0,score})
    socket.join(`room_${roomId}`);callback?.({ok:true});io.to(`room_${roomId}`).emit('room_update',formatRoomUpdate(room))
  })

  socket.on('reconnect_room', ({ userId }, callback) => {
    const room=findUserRoom(userId); if(!room)return callback?.({ok:false,action:'lobby'})
    const p=room.players.get(userId); if(!p)return callback?.({ok:false,action:'lobby'})
    socket.data.userId=userId;socket.data.username=p.username;p.socketId=socket.id;p.offline=false;socket.join(`room_${room.roomId}`)
    callback?.({ok:true,action:'stay'});sendFullGameState(socket,room,userId)
  })

  socket.on('player_ready', () => {
    const userId=socket.data.userId; if(!userId)return; const room=findUserRoom(userId); if(!room||room.phase!=='waiting')return
    const p=room.players.get(userId); if(!p||p.offline)return; p.isReady=!p.isReady; io.to(`room_${room.roomId}`).emit('room_update',formatRoomUpdate(room))
    if(room.players.size>=2&&Array.from(room.players.values()).filter(pp=>!pp.offline).length>=2&&Array.from(room.players.values()).every(pp=>pp.isReady&&!pp.offline)){console.log(`🎯 房间 ${room.roomId} 进入抢庄`);startRobbing(room)}
  })
  socket.on('rob_choice', ({ wantsRob }) => {
    const userId=socket.data.userId; if(!userId)return; const room=findUserRoom(userId); if(!room||room.phase!=='robbing')return
    const p=room.players.get(userId); if(!p||p.hasRobbed||p.offline)return; p.hasRobbed=true;p.wantsRob=!!wantsRob
    io.to(`room_${room.roomId}`).emit('rob_choice_made',{userId,wantsRob:p.wantsRob})
    if(Array.from(room.players.values()).every(pp=>pp.hasRobbed)){clearCountdown(room);finishRobbing(room)}
  })
  socket.on('showdown', () => { const userId=socket.data.userId; if(!userId)return; const room=findUserRoom(userId); if(room)handleShowdown(room,userId) })
  
  socket.on('leave_room', () => {
    const userId=socket.data.userId; if(!userId)return; const room=findUserRoom(userId); if(!room)return; socket.leave(`room_${room.roomId}`)
    if(room.phase!=='waiting'){clearAllTimers(room);room.phase='waiting';room.deck=[];room.bankerId='';room.robbers=[];for(const[uid,p]of room.players){playerStatusMap.set(uid,'idle');p.hand=[];p.bullResult='';p.isReady=false;p.hasShownDown=false;p.hasRobbed=false;p.wantsRob=false;p.offline=false;p.roundScore=0}}
    room.players.delete(userId);playerStatusMap.set(userId,'idle')
    if(room.players.size===0){clearAllTimers(room);rooms.delete(room.roomId);return}
    if(room.ownerId===userId)room.ownerId=room.players.values().next().value.userId
    io.to(`room_${room.roomId}`).emit('phase_changed',{phase:'waiting'});io.to(`room_${room.roomId}`).emit('room_update',formatRoomUpdate(room))
  })

  socket.on('disconnect', () => {
    const userId=socket.data.userId; if(!userId)return; const room=findUserRoom(userId); if(!room)return; socket.leave(`room_${room.roomId}`)
    if(room.phase==='waiting'){room.players.delete(userId);playerStatusMap.set(userId,'idle');if(room.players.size===0){clearAllTimers(room);rooms.delete(room.roomId);return}if(room.ownerId===userId)room.ownerId=room.players.values().next().value.userId;io.to(`room_${room.roomId}`).emit('phase_changed',{phase:'waiting'});io.to(`room_${room.roomId}`).emit('room_update',formatRoomUpdate(room));return}
    const p=room.players.get(userId)
    if(p){p.offline=true;console.log(`🔌 ${socket.data.username} 离线托管`)
      if(room.phase==='robbing'&&!p.hasRobbed){p.hasRobbed=true;p.wantsRob=false;io.to(`room_${room.roomId}`).emit('rob_choice_made',{userId,wantsRob:false});if(Array.from(room.players.values()).every(pp=>pp.hasRobbed)){clearCountdown(room);finishRobbing(room)}}
      io.to(`room_${room.roomId}`).emit('room_update',formatRoomUpdate(room))
    }
  })
})

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`🚀 服务器已启动: http://localhost:${PORT}`))
