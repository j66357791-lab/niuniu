import User from '../models/User.js'
import Transaction from '../models/Transaction.js'
import { rooms, playerStatusMap, findUserRoom, formatRoomUpdate, clearAllTimers, removeUserFromRoom, sendFullGameState, clearBoxTimer } from './games/niuniu/state.js'
import { finishRobbing, startPlaying } from './games/niuniu/handler.js'

function startCountdown(io, room, seconds, phase, onEnd) {
  clearCountdown(room)
  room.countdownSeconds = seconds
  io.to(`room_${room.roomId}`).emit('countdown', { seconds, phase })
  room.countdownTimer = setInterval(() => {
    room.countdownSeconds--
    io.to(`room_${room.roomId}`).emit('countdown', { seconds: room.countdownSeconds, phase })
    if (room.countdownSeconds <= 0) {
      clearCountdown(room); onEnd()
    }
  }, 1000)
}

export function clearCountdown(room) {
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer); room.countdownTimer = null
  }
}

export function checkAllPeasantBet(io, room) {
  const allBet = Array.from(room.players.values())
    .filter(p => p.role === 'player' && p.userId !== room.bankerId)
    .every(p => p.betMultiplier > 0)
  if (allBet) {
    clearCountdown(room); startBankerDouble(io, room)
  }
}

export function startBankerDouble(io, room) {
  room.phase = 'banker_double'
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'banker_double' })
  const banker = room.players.get(room.bankerId)
  if (banker) io.to(`room_${room.roomId}`).emit('deal_cards', { players: [{ userId: room.bankerId, publicCards: banker.hand.slice(0, 3) }] })
  startCountdown(io, room, 10, 'banker_double', () => {
    if (!rooms.has(room.roomId) || room.phase !== 'banker_double') return
    if (!room.bankerDoubled) room.bankerDoubled = false
    io.to(`room_${room.roomId}`).emit('banker_double_choice', { doubled: room.bankerDoubled })
    startPlaying(io, room)
  })
}

async function forceSettleBox(io, room) {
  if (!room || !room.currentBox || room.currentBox.isFinished) return
  room.currentBox.isFinished = true
  clearBoxTimer(room)
  const box = room.currentBox
  const refund = box.remaining
  try {
    if (refund > 0) {
      const session = await User.startSession()
      session.startTransaction()
      try {
        const u = await User.findById(box.sponsorId).session(session)
        await User.updateOne({ _id: box.sponsorId }, { $inc: { score: refund } }).session(session)
        await Transaction.create([{ userId: box.sponsorId, type: 'sys_add', amount: refund, balance_after: u.score + refund, description: '红包过期退回' }], { session })
        await session.commitTransaction()
        if (io) io.to(`user_${box.sponsorId}`).emit('score_sync', { newScore: u.score + refund })
        const sponsor = room.players.get(box.sponsorId)
        if (sponsor) sponsor.score = u.score + refund
      } catch (err) {
        await session.abortTransaction(); console.error('红包退款失败:', err)
      } finally {
        session.endSession()
      }
    }
    if (box.grabbedList.length > 0) {
      const session2 = await User.startSession()
      session2.startTransaction()
      try {
        const userIds = box.grabbedList.map(g => g.userId)
        const users = await User.find({ _id: { $in: userIds } }).session(session2).select('score').lean()
        const scoreMap = {}
        for (const u of users) scoreMap[u._id.toString()] = u.score
        const bulkOps = [], txDocs = []
        for (const g of box.grabbedList) {
          bulkOps.push({ updateOne: { filter: { _id: g.userId }, update: { $inc: { score: g.amount } } } })
          txDocs.push({ userId: g.userId, type: 'sys_add', amount: g.amount, balance_after: scoreMap[g.userId] + g.amount, description: '抢红包' })
        }
        await User.bulkWrite(bulkOps, { session: session2 })
        await Transaction.insertMany(txDocs, { session: session2 })
        await session2.commitTransaction()
        if (io) {
          for (const g of box.grabbedList) {
            io.to(`user_${g.userId}`).emit('score_sync', { newScore: scoreMap[g.userId] + g.amount })
            const p = room.players.get(g.userId)
            if (p) p.score = scoreMap[g.userId] + g.amount
          }
        }
      } catch (err) {
        await session2.abortTransaction(); console.error('红包发放失败:', err)
      } finally {
        session2.endSession()
      }
    }
  } catch (e) {
    console.error('红包结算异常:', e)
  }
  io.to(`room_${room.roomId}`).emit('box_opened', {
    totalAmount: box.totalAmount,
    grabbedList: box.grabbedList.sort((a, b) => b.amount - a.amount),
    refund
  })
  room.currentBox = null
}

// ✅ 修复点1：删除了 import { getIO } 
// ✅ 修复点2：函数名改为 registerBaseHandlers，参数改为 (io, socket) 匹配 index.js 调用
export function registerBaseHandlers(io, socket) {
  socket.on('auth', ({ userId, username }) => {
    socket.data.userId = userId; socket.data.username = username
    if (!playerStatusMap.has(userId)) playerStatusMap.set(userId, 'idle')
    socket.join(`user_${userId}`)
  })

  socket.on('create_room', async ({ password, maxPlayers, baseScore }, callback) => {
    const userId = socket.data.userId, username = socket.data.username
    if (!userId) return callback?.({ ok: false, msg: '未认证' })
    if (!password || password.length < 4) return callback?.({ ok: false, msg: '密码至少4位' })
    if (playerStatusMap.get(userId) === 'in_game') return callback?.({ ok: false, msg: '您在其他房间有未结束的对局，请等待结算' })
    let score = 0
    try {
      const u = await User.findById(userId).select('score').lean(); if (u) score = u.score
    } catch { }
    if (score < 100) return callback?.({ ok: false, msg: '积分不足100，无法创建房间' })
    const prev = findUserRoom(userId)
    if (prev) { socket.leave(`room_${prev.roomId}`); removeUserFromRoom(io, prev, userId) }
    let roomId
    do { roomId = String(Math.floor(1000 + Math.random() * 9000)) } while (rooms.has(roomId))
    const mp = parseInt(maxPlayers) || 4, bs = parseInt(baseScore) || 10
    if (![10, 30, 50, 100].includes(bs)) return callback?.({ ok: false, msg: '底分档位不正确' })
    const room = {
      roomId, password, ownerId: userId, phase: 'waiting', deck: [], bankerId: '',
      maxPlayers: mp, baseScore: bs, bankerDoubled: false, robbers: [], currentBox: null,
      countdownTimer: null, robAnimTimer: null, dealTimer: null, settleTimer: null, countdownSeconds: 0,
      players: new Map([[userId, {
        userId, username, socketId: socket.id, isReady: false, hasRobbed: false, wantsRob: false,
        hand: [], bullResult: null, bullResultObj: null, hasShownDown: false, offline: false,
        roundScore: 0, score, role: 'player', betMultiplier: 0
      }]])
    }
    rooms.set(roomId, room); socket.join(`room_${roomId}`)
    callback?.({ ok: true, roomId })
  })

  socket.on('join_room', async ({ roomId, password }, callback) => {
    const userId = socket.data.userId, username = socket.data.username
    if (!userId) return callback?.({ ok: false, msg: '未认证' })
    if (playerStatusMap.get(userId) === 'in_game') return callback?.({ ok: false, msg: '您在其他房间有未结束的对局，请等待结算' })
    const room = rooms.get(roomId)
    if (!room) return callback?.({ ok: false, msg: '房间不存在' })
    if (room.players.has(userId)) { callback?.({ ok: true }); sendFullGameState(socket, room, userId); return }
    if (room.password !== password) return callback?.({ ok: false, msg: '房间密码错误' })
    const isSpectator = room.phase !== 'waiting'
    if (!isSpectator && room.players.size >= room.maxPlayers) return callback?.({ ok: false, msg: '房间已满' })
    let score = 0
    try {
      const u = await User.findById(userId).select('score').lean(); if (u) score = u.score
    } catch { }
    if (!isSpectator && score < 100) return callback?.({ ok: false, msg: '积分不足100，无法加入该房间' })
    const prev = findUserRoom(userId)
    if (prev) { socket.leave(`room_${prev.roomId}`); removeUserFromRoom(io, prev, userId) }
    room.players.set(userId, {
      userId, username, socketId: socket.id, isReady: false, hasRobbed: false, wantsRob: false,
      hand: [], bullResult: null, bullResultObj: null, hasShownDown: false, offline: false,
      roundScore: 0, score, role: isSpectator ? 'spectator' : 'player', betMultiplier: 0
    })
    socket.join(`room_${roomId}`)
    io.to(`room_${room.roomId}`).emit('room_notice', { message: `欢迎 ${username} ${isSpectator ? '观战' : '加入'}房间`, ownerName: room.players.get(room.ownerId)?.username })
    callback?.({ ok: true, isSpectator })
    io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
    if (isSpectator) sendFullGameState(socket, room, userId)
  })

  socket.on('reconnect_room', ({ userId }, callback) => {
    const room = findUserRoom(userId)
    if (!room) return callback?.({ ok: false, action: 'lobby' })
    const p = room.players.get(userId)
    if (!p) return callback?.({ ok: false, action: 'lobby' })
    socket.data.userId = userId; socket.data.username = p.username; p.socketId = socket.id; p.offline = false
    socket.join(`room_${room.roomId}`); socket.join(`user_${userId}`)
    callback?.({ ok: true, action: 'stay' }); sendFullGameState(socket, room, userId)
  })

  socket.on('leave_room', () => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room) return
    socket.leave(`room_${room.roomId}`)
    if (room.phase === 'waiting' && room.currentBox && !room.currentBox.isFinished) { forceSettleBox(io, room) }
    if (room.phase !== 'waiting') {
      clearAllTimers(room)
      room.phase = 'waiting'; room.deck = []; room.bankerId = ''; room.robbers = []; room.bankerDoubled = false
      for (const [uid, p] of room.players) {
        playerStatusMap.set(uid, 'idle'); p.hand = []; p.bullResult = null; p.bullResultObj = null
        p.isReady = false; p.hasShownDown = false; p.hasRobbed = false; p.wantsRob = false
        p.offline = false; p.roundScore = 0; p.betMultiplier = 0; p.role = 'player'
      }
    }
    room.players.delete(userId); playerStatusMap.set(userId, 'idle')
    if (room.players.size === 0) { clearAllTimers(room); rooms.delete(room.roomId); return }
    if (room.ownerId === userId) room.ownerId = room.players.values().next().value.userId
    io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
    io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  })

  socket.on('disconnect', () => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room) return
    socket.leave(`room_${room.roomId}`)
    if (room.phase === 'waiting' && room.currentBox && !room.currentBox.isFinished) { forceSettleBox(io, room) }
    if (room.phase === 'waiting') {
      room.players.delete(userId); playerStatusMap.set(userId, 'idle')
      if (room.players.size === 0) { clearAllTimers(room); rooms.delete(room.roomId); return }
      if (room.ownerId === userId) room.ownerId = room.players.values().next().value.userId
      io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
      io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
      return
    }
    const p = room.players.get(userId)
    if (p) {
      p.offline = true
      if (room.phase === 'robbing' && !p.hasRobbed) {
        p.hasRobbed = true; p.wantsRob = false
        io.to(`room_${room.roomId}`).emit('rob_choice_made', { userId, wantsRob: false })
        if (Array.from(room.players.values()).filter(x => x.role === 'player').every(pp => pp.hasRobbed)) { clearCountdown(room); finishRobbing(io, room) }
      }
      if (room.phase === 'peasant_bet' && p.role === 'player' && userId !== room.bankerId && !p.betMultiplier) {
        p.betMultiplier = 1
        io.to(`room_${room.roomId}`).emit('bet_choice', { userId, multiplier: 1 })
        checkAllPeasantBet(io, room)
      }
      if (room.phase === 'banker_double' && userId === room.bankerId && !room.bankerDoubled) {
        room.bankerDoubled = false
        io.to(`room_${room.roomId}`).emit('banker_double_choice', { doubled: false })
        startPlaying(io, room)
      }
      io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
    }
  })

  socket.on('chat_bubble', ({ bubbleId }) => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room) return
    socket.to(`room_${room.roomId}`).emit('chat_bubble', { userId, username: socket.data.username, bubbleId })
  })

  socket.on('create_box', async ({ totalAmount, maxGrabbers }, callback) => {
    const userId = socket.data.userId
    if (!userId) return callback?.({ ok: false, msg: '未认证' })
    const room = findUserRoom(userId)
    if (!room) return callback?.({ ok: false, msg: '房间不存在' })
    if (room.phase !== 'waiting') return callback?.({ ok: false, msg: '只能在准备阶段发红包' })
    if (!totalAmount || totalAmount <= 0) return callback?.({ ok: false, msg: '金额必须大于0' })
    if (!maxGrabbers || maxGrabbers < 2) return callback?.({ ok: false, msg: '至少2人抢' })
    const activePlayers = Array.from(room.players.values()).filter(p => p.role === 'player')
    if (maxGrabbers > activePlayers.length) return callback?.({ ok: false, msg: '抢的人数不能超过房间人数' })
    const sponsor = room.players.get(userId)
    if (sponsor.score < totalAmount) return callback?.({ ok: false, msg: '积分不足' })
    const session = await User.startSession()
    session.startTransaction()
    try {
      const u = await User.findById(userId).session(session)
      if (u.score < totalAmount) { await session.abortTransaction(); return callback?.({ ok: false, msg: '积分不足' }) }
      await User.updateOne({ _id: userId }, { $inc: { score: -totalAmount } }).session(session)
      await Transaction.create([{ userId, type: 'fee', amount: -totalAmount, balance_after: u.score - totalAmount, description: '发放红包' }], { session })
      await session.commitTransaction()
      if (io) io.to(`user_${userId}`).emit('score_sync', { newScore: u.score - totalAmount })
      sponsor.score = u.score - totalAmount
      room.currentBox = { sponsorId: userId, totalAmount, maxGrabbers, grabbedList: [], remaining: totalAmount, isFinished: false, timer: null }
      io.to(`room_${room.roomId}`).emit('box_appear', { sponsorId: userId, totalAmount, maxGrabbers })
      clearBoxTimer(room)
      room.currentBox.timer = setTimeout(() => forceSettleBox(io, room), 60000)
      callback?.({ ok: true })
    } catch (err) {
      await session.abortTransaction(); console.error('发红包失败:', err)
      callback?.({ ok: false, msg: '发红包失败' })
    } finally {
      session.endSession()
    }
  })

  socket.on('grab_box', (_, callback) => {
    const userId = socket.data.userId
    if (!userId) return callback?.({ ok: false, msg: '未认证' })
    const room = findUserRoom(userId)
    if (!room || !room.currentBox || room.currentBox.isFinished) return callback?.({ ok: false, msg: '没有可抢的红包' })
    if (room.phase !== 'waiting') return callback?.({ ok: false, msg: '只能在准备阶段抢' })
    const box = room.currentBox
    if (box.grabbedList.find(g => g.userId === userId)) return callback?.({ ok: false, msg: '你已经抢过了' })
    const remainingPeople = box.maxGrabbers - box.grabbedList.length
    let grabCents = 0
    const remCents = Math.round(box.remaining * 100)
    if (remainingPeople === 1) {
      grabCents = remCents
    } else {
      const maxGrabCents = Math.floor((remCents / remainingPeople) * 2)
      if (maxGrabCents <= 1) { grabCents = 1 } else { grabCents = Math.floor(Math.random() * maxGrabCents) + 1 }
    }
    const actualGrab = Math.round(grabCents) / 100
    box.remaining = Math.round((remCents - grabCents)) / 100
    if (box.remaining < 0) box.remaining = 0
    box.grabbedList.push({ userId, amount: actualGrab })
    io.to(`room_${room.roomId}`).emit('box_grabbed', { userId, amount: actualGrab, remainingCount: remainingPeople - 1, grabbedList: box.grabbedList })
    callback?.({ ok: true, amount: actualGrab })
    if (box.grabbedList.length >= box.maxGrabbers) { clearBoxTimer(room); forceSettleBox(io, room) }
  })
}
