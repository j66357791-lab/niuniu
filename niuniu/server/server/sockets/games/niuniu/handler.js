import { rooms, playerStatusMap, findUserRoom, clearAllTimers } from '../../baseState.js'
import { formatRoomUpdate, sendFullGameState, clearBoxTimer } from './state.js'
import { createDeck, shuffle, calculateBull, calculateGameResults } from './logic.js'
import User from '../../../models/User.js'
import Transaction from '../../../models/Transaction.js'

// 【架构升级】向万能插座注册自己，从此不再和 baseHandler 耦合
import { registerGame } from '../../baseHandler.js'

// 抽离纯函数：牛牛专属的断线托管逻辑
function handleNiuniuOffline(io, room, userId, phase) {
  const p = room.players.get(userId)
  if (!p) return
  if (phase === 'robbing' && !p.hasRobbed) {
    p.hasRobbed = true
    p.wantsRob = false
    io.to(`room_${room.roomId}`).emit('rob_choice_made', { userId, wantsRob: false })
    if (Array.from(room.players.values()).filter(x => x.role === 'player').every(pp => pp.hasRobbed)) {
      clearCountdown(room)
      finishRobbing(io, room)
    }
  }
  if (phase === 'peasant_bet' && p.role === 'player' && userId !== room.bankerId && !p.betMultiplier) {
    p.betMultiplier = 1
    io.to(`room_${room.roomId}`).emit('bet_choice', { userId, multiplier: 1 })
    checkAllPeasantBet(io, room)
  }
  if (phase === 'banker_double' && userId === room.bankerId && !room.bankerDoubled) {
    room.bankerDoubled = false
    io.to(`room_${room.roomId}`).emit('banker_double_choice', { doubled: false })
    startPlaying(io, room)
  }
}

// 【关键】将 UI渲染、全量补发、断线托管 三件套打包注册
registerGame('niuniu', formatRoomUpdate, sendFullGameState, handleNiuniuOffline)

// ==========================================
// 以下为牛牛内部专属状态机，与外界彻底隔离
// ==========================================

function startCountdown(io, room, seconds, phase, onEnd) {
  clearCountdown(room)
  room.countdownSeconds = seconds
  io.to(`room_${room.roomId}`).emit('countdown', { seconds, phase })
  room.countdownTimer = setInterval(() => {
    room.countdownSeconds--
    io.to(`room_${room.roomId}`).emit('countdown', { seconds: room.countdownSeconds, phase })
    if (room.countdownSeconds <= 0) {
      clearCountdown(room)
      onEnd()
    }
  }, 1000)
}

function clearCountdown(room) {
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer)
    room.countdownTimer = null
  }
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
        await session.abortTransaction()
        console.error('红包退款失败:', err)
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
        const bulkOps = []
        const txDocs = []
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
        await session2.abortTransaction()
        console.error('红包发放失败:', err)
      } finally {
        session2.endSession()
      }
    }
  } catch (e) {
    console.error('红包结算异常:', e)
  }
  io.to(`room_${room.roomId}`).emit('box_opened', { totalAmount: box.totalAmount, grabbedList: box.grabbedList.sort((a, b) => b.amount - a.amount), refund })
  room.currentBox = null
}

function checkAllPeasantBet(io, room) {
  const allBet = Array.from(room.players.values()).filter(p => p.role === 'player' && p.userId !== room.bankerId).every(p => p.betMultiplier > 0)
  if (allBet) {
    clearCountdown(room)
    startBankerDouble(io, room)
  }
}

function startBankerDouble(io, room) {
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

function startDealingHidden(io, room) {
  room.phase = 'dealing_hidden'
  room.robbers = []
  room.bankerDoubled = false
  for (const p of room.players.values()) {
    if (p.role === 'spectator') continue
    p.hasRobbed = false
    p.wantsRob = false
    p.hand = []
    p.bullResult = null
    p.bullResultObj = null
    p.hasShownDown = false
    p.roundScore = p.score
    p.betMultiplier = 0
    playerStatusMap.set(p.userId, 'in_game')
  }
  room.deck = shuffle(createDeck())
  let idx = 0
  for (const p of room.players.values()) {
    if (p.role === 'spectator') continue
    p.hand = room.deck.slice(idx, idx + 5)
    idx += 5
    io.to(p.socketId).emit('deal_cards_private', { privateCards: p.hand })
  }
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'dealing_hidden' })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  room.dealTimer = setTimeout(() => {
    room.dealTimer = null
    if (rooms.has(room.roomId)) startRobbing(io, room)
  }, 1500)
}

function startRobbing(io, room) {
  room.phase = 'robbing'
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'robbing' })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  startCountdown(io, room, 15, 'robbing', () => finishRobbing(io, room))
}

export function finishRobbing(io, room) {
  if (!rooms.has(room.roomId) || room.phase !== 'robbing') return
  const activePlayers = Array.from(room.players.values()).filter(p => p.role === 'player')
  for (const p of activePlayers) {
    if (!p.hasRobbed) p.wantsRob = false
  }
  const rob = activePlayers.filter(p => p.wantsRob).map(p => p.userId)
  room.robbers = rob
  if (rob.length === 0) selectBanker(io, room, activePlayers[Math.floor(Math.random() * activePlayers.length)].userId)
  else if (rob.length === 1) selectBanker(io, room, rob[0])
  else startRobAnimation(io, room, rob)
}

function selectBanker(io, room, bankerId) {
  room.bankerId = bankerId
  room.phase = 'banker_confirmed'
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'banker_confirmed', bankerId, robbers: room.robbers })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  room.dealTimer = setTimeout(() => {
    room.dealTimer = null
    if (rooms.has(room.roomId)) startPeasantBet(io, room)
  }, 1000)
}

function startRobAnimation(io, room, robbers) {
  room.phase = 'rob_animating'
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'rob_animating', robbers })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  room.robAnimTimer = setTimeout(() => {
    room.robAnimTimer = null
    if (!rooms.has(room.roomId) || room.phase !== 'rob_animating') return
    selectBanker(io, room, robbers[Math.floor(Math.random() * robbers.length)])
  }, 5000)
}

function startPeasantBet(io, room) {
  room.phase = 'peasant_bet'
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'peasant_bet' })
  for (const [uid, p] of room.players) {
    if (p.role === 'spectator') continue
    if (uid === room.bankerId) {
      const pub = []
      for (const [puid, pp] of room.players) {
        if (puid !== room.bankerId && pp.role === 'player') pub.push({ userId: puid, publicCards: pp.hand.slice(0, 3) })
      }
      if (pub.length) io.to(p.socketId).emit('deal_cards', { players: pub })
    } else {
      io.to(p.socketId).emit('deal_cards', { players: [{ userId: uid, publicCards: p.hand.slice(0, 3) }] })
    }
  }
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  checkAllPeasantBet(io, room)
  startCountdown(io, room, 15, 'peasant_bet', () => {
    if (!rooms.has(room.roomId) || room.phase !== 'peasant_bet') return
    for (const [uid, p] of room.players) {
      if (uid !== room.bankerId && p.role === 'player' && !p.betMultiplier) {
        p.betMultiplier = 1
        io.to(`room_${room.roomId}`).emit('bet_choice', { userId: uid, multiplier: 1 })
      }
    }
    startBankerDouble(io, room)
  })
}

export function startPlaying(io, room) {
  room.phase = 'playing'
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'playing' })
  for (const [uid, p] of room.players) {
    if (uid !== room.bankerId && p.role === 'player' && p.offline && !p.hasShownDown) {
      p.hasShownDown = true
      p.bullResultObj = calculateBull(p.hand)
      p.bullResult = p.bullResultObj.result
      io.to(`room_${room.roomId}`).emit('player_showdown', { userId: uid, privateCards: p.hand.slice(3), bullResult: p.bullResultObj })
    }
  }
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  if (allPeasantsShown(room)) startBankerPlaying(io, room)
  else startCountdown(io, room, 15, 'playing', () => {
    if (rooms.has(room.roomId) && room.phase === 'playing') forceShowPeasants(io, room)
  })
}

function handleShowdown(io, room, userId) {
  const p = room.players.get(userId)
  if (!p || p.hasShownDown || p.offline) return
  if (room.phase === 'playing' && userId === room.bankerId) return
  if (room.phase === 'banker_playing' && userId !== room.bankerId) return
  p.hasShownDown = true
  p.bullResultObj = calculateBull(p.hand)
  p.bullResult = p.bullResultObj.result
  io.to(`room_${room.roomId}`).emit('player_showdown', { userId, privateCards: p.hand.slice(3), bullResult: p.bullResultObj })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  if (room.phase === 'playing') {
    if (allPeasantsShown(room)) {
      clearCountdown(room)
      startBankerPlaying(io, room)
    }
  } else if (room.phase === 'banker_playing') {
    if (allPlayersShown(room)) {
      clearCountdown(room)
      settleGame(io, room)
    }
  }
}

function allPeasantsShown(r) {
  for (const [uid, p] of r.players) {
    if (uid !== r.bankerId && p.role === 'player' && !p.hasShownDown) return false
  }
  return true
}

function allPlayersShown(r) {
  return Array.from(r.players.values()).filter(p => p.role === 'player').every(p => p.hasShownDown)
}

function forceShowPeasants(io, room) {
  for (const [uid, p] of room.players) {
    if (uid === room.bankerId || p.hasShownDown || p.role === 'spectator') continue
    p.hasShownDown = true
    p.bullResultObj = calculateBull(p.hand)
    p.bullResult = p.bullResultObj.result
    io.to(`room_${room.roomId}`).emit('player_showdown', { userId: uid, privateCards: p.hand.slice(3), bullResult: p.bullResultObj })
  }
  startBankerPlaying(io, room)
}

function startBankerPlaying(io, room) {
  room.phase = 'banker_playing'
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'banker_playing' })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  const b = room.players.get(room.bankerId)
  if (b && b.offline && !b.hasShownDown) {
    b.hasShownDown = true
    b.bullResultObj = calculateBull(b.hand)
    b.bullResult = b.bullResultObj.result
    io.to(`room_${room.roomId}`).emit('player_showdown', { userId: room.bankerId, privateCards: b.hand.slice(3), bullResult: b.bullResultObj })
    settleGame(io, room)
  } else {
    startCountdown(io, room, 5, 'banker_playing', () => {
      if (rooms.has(room.roomId) && room.phase === 'banker_playing') forceBankerShowdown(io, room)
    })
  }
}

function forceBankerShowdown(io, room) {
  const b = room.players.get(room.bankerId)
  if (b && !b.hasShownDown) {
    b.hasShownDown = true
    b.bullResultObj = calculateBull(b.hand)
    b.bullResult = b.bullResultObj.result
    io.to(`room_${room.roomId}`).emit('player_showdown', { userId: room.bankerId, privateCards: b.hand.slice(3), bullResult: b.bullResultObj })
  }
  settleGame(io, room)
}

async function settleGame(io, room) {
  room.phase = 'settling'
  const results = calculateGameResults(room)
  const session = await User.startSession()
  session.startTransaction()
  try {
    const userIds = results.map(r => r.userId)
    const users = await User.find({ _id: { $in: userIds } }).session(session).select('score').lean()
    const scoreMap = {}
    for (const u of users) scoreMap[u._id.toString()] = u.score
    for (const r of results) {
      if (r.scoreChange < 0 && Math.abs(r.scoreChange) > scoreMap[r.userId]) r.scoreChange = -scoreMap[r.userId]
      r.newTotal = scoreMap[r.userId] + r.scoreChange
    }
    const br = results.find(r => r.isBanker)
    let bankerDelta = 0
    for (const r of results) {
      if (!r.isBanker) bankerDelta -= r.scoreChange
    }
    if (bankerDelta < 0 && Math.abs(bankerDelta) > scoreMap[br.userId]) bankerDelta = -scoreMap[br.userId]
    br.scoreChange = bankerDelta
    br.newTotal = scoreMap[br.userId] + bankerDelta
    const bulkOps = results.map(r => ({ updateOne: { filter: { _id: r.userId }, update: { $inc: { score: r.scoreChange } } } }))
    const txDocs = results.map(r => ({ userId: r.userId, type: r.scoreChange >= 0 ? 'game_win' : 'game_lose', amount: r.scoreChange, balance_after: r.newTotal, description: r.scoreChange >= 0 ? '牛牛对局胜利' : '牛牛对局失败' }))
    await User.bulkWrite(bulkOps, { session })
    await Transaction.insertMany(txDocs, { session })
    await session.commitTransaction()
    for (const r of results) {
      const p = room.players.get(r.userId)
      if (p && !p.offline) io.to(p.socketId).emit('score_sync', { newScore: r.newTotal })
    }
  } catch (err) {
    await session.abortTransaction()
    console.error('结算事务失败，已回滚:', err)
  } finally {
    session.endSession()
  }
  io.to(`room_${room.roomId}`).emit('game_result', { results })
  room.settleTimer = setTimeout(() => {
    room.settleTimer = null
    if (rooms.has(room.roomId)) resetRoom(io, room)
  }, 10000)
}

function resetRoom(io, room) {
  clearAllTimers(room)
  room.phase = 'waiting'
  room.deck = []
  room.bankerId = ''
  room.robbers = []
  room.bankerDoubled = false
  const toRemove = []
  for (const [uid, p] of room.players) {
    if (p.offline) {
      toRemove.push(uid)
    } else {
      p.hand = []
      p.bullResult = null
      p.bullResultObj = null
      p.isReady = false
      p.hasShownDown = false
      p.hasRobbed = false
      p.wantsRob = false
      p.offline = false
      p.roundScore = 0
      p.betMultiplier = 0
      p.role = 'player'
      p.offlineTimer = null
    }
  }
  for (const uid of toRemove) {
    room.players.delete(uid)
    playerStatusMap.set(uid, 'idle')
  }
  for (const [uid] of room.players) playerStatusMap.set(uid, 'idle')
  if (room.players.size === 0) {
    rooms.delete(room.roomId)
    return
  }
  if (!room.players.has(room.ownerId)) room.ownerId = room.players.values().next().value.userId
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
}

// ==========================================
// 注册牛牛专属事件
// ==========================================
export function niuniuHandler(socket, io) {
  
  // 【已删除】socket.on('__player_offline')，因为彻底解耦，不再需要内部转发

  socket.on('__force_settle_box', () => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (room) forceSettleBox(io, room)
  })

  socket.on('player_ready', () => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room || room.phase !== 'waiting') return
    const p = room.players.get(userId)
    if (!p || p.offline || p.role === 'spectator') return
    p.isReady = !p.isReady
    io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
    const activePlayers = Array.from(room.players.values()).filter(pp => pp.role === 'player')
    if (activePlayers.length >= 2 && activePlayers.every(pp => pp.isReady && !pp.offline)) startDealingHidden(io, room)
  })

  socket.on('rob_choice', ({ wantsRob }) => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room || room.phase !== 'robbing') return
    const p = room.players.get(userId)
    if (!p || p.hasRobbed || p.offline || p.role === 'spectator') return
    p.hasRobbed = true
    p.wantsRob = !!wantsRob
    io.to(`room_${room.roomId}`).emit('rob_choice_made', { userId, wantsRob: p.wantsRob })
    io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
    if (Array.from(room.players.values()).filter(x => x.role === 'player').every(pp => pp.hasRobbed)) {
      clearCountdown(room)
      finishRobbing(io, room)
    }
  })

  socket.on('peasant_bet', ({ multiplier }) => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room || room.phase !== 'peasant_bet' || userId === room.bankerId) return
    const p = room.players.get(userId)
    if (!p || p.betMultiplier || p.offline || p.role === 'spectator') return
    p.betMultiplier = multiplier
    io.to(`room_${room.roomId}`).emit('bet_choice', { userId, multiplier })
    io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
    checkAllPeasantBet(io, room)
  })

  socket.on('banker_double', ({ doubled }) => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room || room.phase !== 'banker_double' || userId !== room.bankerId) return
    room.bankerDoubled = doubled
    io.to(`room_${room.roomId}`).emit('banker_double_choice', { doubled })
    io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
    clearCountdown(room)
    startPlaying(io, room)
  })

  socket.on('showdown', () => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (room) handleShowdown(io, room, userId)
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
      if (u.score < totalAmount) {
        await session.abortTransaction()
        return callback?.({ ok: false, msg: '积分不足' })
      }
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
      await session.abortTransaction()
      console.error('发红包失败:', err)
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
      grabCents = maxGrabCents <= 1 ? 1 : Math.floor(Math.random() * maxGrabCents) + 1
    }
    const actualGrab = Math.round(grabCents) / 100
    box.remaining = Math.round((remCents - grabCents)) / 100
    if (box.remaining < 0) box.remaining = 0
    box.grabbedList.push({ userId, amount: actualGrab })
    io.to(`room_${room.roomId}`).emit('box_grabbed', { userId, amount: actualGrab, remainingCount: remainingPeople - 1, grabbedList: box.grabbedList })
    callback?.({ ok: true, amount: actualGrab })
    if (box.grabbedList.length >= box.maxGrabbers) {
      clearBoxTimer(room)
      forceSettleBox(io, room)
    }
  })
}
