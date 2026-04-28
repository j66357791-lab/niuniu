import { rooms, playerStatusMap, findUserRoom, formatRoomUpdate, clearAllTimers } from './state.js'
import { createDeck, shuffle, calculateBull, calculateGameResults } from './logic.js'
import User from '../../../models/User.js'
import Transaction from '../../../models/Transaction.js'
import { checkAllPeasantBet, startBankerDouble, clearCountdown } from '../../baseHandler.js'

function startCountdown(io, room, seconds, phase, onEnd) {
  clearCountdown(room)
  room.countdownSeconds = seconds
  io.to(`room_${room.roomId}`).emit('countdown', { seconds, phase })
  room.countdownTimer = setInterval(() => {
    room.countdownSeconds--
    io.to(`room_${room.roomId}`).emit('countdown', { seconds: room.countdownSeconds, phase })
    if (room.countdownSeconds <= 0) { clearCountdown(room); onEnd() }
  }, 1000)
}

function startDealingHidden(io, room) {
  room.phase = 'dealing_hidden'
  room.robbers = []; room.bankerDoubled = false
  for (const p of room.players.values()) {
    if (p.role === 'spectator') continue
    p.hasRobbed = false; p.wantsRob = false; p.hand = []; p.bullResult = null; p.bullResultObj = null
    p.hasShownDown = false; p.roundScore = p.score; p.betMultiplier = 0
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
    if (!rooms.has(room.roomId)) return
    startRobbing(io, room)
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
  for (const p of activePlayers) { if (!p.hasRobbed) p.wantsRob = false }
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
    if (!rooms.has(room.roomId)) return
    startPeasantBet(io, room)
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
      for (const [puid, pp] of room.players) { if (puid !== room.bankerId && pp.role === 'player') pub.push({ userId: puid, publicCards: pp.hand.slice(0, 3) }) }
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
      if (uid !== room.bankerId && p.role === 'player' && !p.betMultiplier && p.offline) {
        p.betMultiplier = 1; io.to(`room_${room.roomId}`).emit('bet_choice', { userId: uid, multiplier: 1 })
      }
    }
    for (const [uid, p] of room.players) {
      if (uid !== room.bankerId && p.role === 'player' && !p.betMultiplier) {
        p.betMultiplier = 1; io.to(`room_${room.roomId}`).emit('bet_choice', { userId: uid, multiplier: 1 })
      }
    }
    startBankerDouble(io, room)
  })
}

// 【注意这里加上了 export】
export function startPlaying(io, room) {
  room.phase = 'playing'
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'playing' })
  for (const [uid, p] of room.players) {
    if (uid !== room.bankerId && p.role === 'player' && p.offline && !p.hasShownDown) {
      p.hasShownDown = true; p.bullResultObj = calculateBull(p.hand); p.bullResult = p.bullResultObj.result
      io.to(`room_${room.roomId}`).emit('player_showdown', { userId: uid, privateCards: p.hand.slice(3), bullResult: p.bullResultObj })
    }
  }
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  if (allPeasantsShown(room)) startBankerPlaying(io, room)
  else startCountdown(io, room, 15, 'playing', () => { if (!rooms.has(room.roomId) || room.phase !== 'playing') return; forceShowPeasants(io, room) })
}

function handleShowdown(io, room, userId) {
  const p = room.players.get(userId)
  if (!p || p.hasShownDown || p.offline) return
  if (room.phase === 'playing' && userId === room.bankerId) return
  if (room.phase === 'banker_playing' && userId !== room.bankerId) return
  p.hasShownDown = true; p.bullResultObj = calculateBull(p.hand); p.bullResult = p.bullResultObj.result
  io.to(`room_${room.roomId}`).emit('player_showdown', { userId, privateCards: p.hand.slice(3), bullResult: p.bullResultObj })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
  if (room.phase === 'playing') { if (allPeasantsShown(room)) { clearCountdown(room); startBankerPlaying(io, room) } }
  else if (room.phase === 'banker_playing') { if (allPlayersShown(room)) { clearCountdown(room); settleGame(io, room) } }
}

function allPeasantsShown(r) { for (const [uid, p] of r.players) { if (uid !== r.bankerId && p.role === 'player' && !p.hasShownDown) return false } return true }
function allPlayersShown(r) { return Array.from(r.players.values()).filter(p => p.role === 'player').every(p => p.hasShownDown) }

function forceShowPeasants(io, room) {
  for (const [uid, p] of room.players) {
    if (uid === room.bankerId || p.hasShownDown || p.role === 'spectator') continue
    p.hasShownDown = true; p.bullResultObj = calculateBull(p.hand); p.bullResult = p.bullResultObj.result
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
    b.hasShownDown = true; b.bullResultObj = calculateBull(b.hand); b.bullResult = b.bullResultObj.result
    io.to(`room_${room.roomId}`).emit('player_showdown', { userId: room.bankerId, privateCards: b.hand.slice(3), bullResult: b.bullResultObj })
    settleGame(io, room)
  } else {
    startCountdown(io, room, 5, 'banker_playing', () => { if (!rooms.has(room.roomId) || room.phase !== 'banker_playing') return; forceBankerShowdown(io, room) })
  }
}

function forceBankerShowdown(io, room) {
  const b = room.players.get(room.bankerId)
  if (b && !b.hasShownDown) {
    b.hasShownDown = true; b.bullResultObj = calculateBull(b.hand); b.bullResult = b.bullResultObj.result
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
    for (const r of results) { if (!r.isBanker) bankerDelta -= r.scoreChange }
    if (bankerDelta < 0 && Math.abs(bankerDelta) > scoreMap[br.userId]) bankerDelta = -scoreMap[br.userId]
    br.scoreChange = bankerDelta; br.newTotal = scoreMap[br.userId] + bankerDelta
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
    if (rooms.has(room.roomId)) { resetRoom(io, room) }
  }, 10000)
}

function resetRoom(io, room) {
  clearAllTimers(room)
  room.phase = 'waiting'; room.deck = []; room.bankerId = ''; room.robbers = []; room.bankerDoubled = false
  const toRemove = []
  for (const [uid, p] of room.players) {
    if (p.offline) {
      toRemove.push(uid)
    } else {
      p.hand = []; p.bullResult = null; p.bullResultObj = null; p.isReady = false; p.hasShownDown = false
      p.hasRobbed = false; p.wantsRob = false; p.offline = false; p.roundScore = 0; p.betMultiplier = 0; p.role = 'player'
    }
  }
  for (const uid of toRemove) { room.players.delete(uid); playerStatusMap.set(uid, 'idle' )}
  for (const [uid] of room.players) playerStatusMap.set(uid, 'idle')
  if (room.players.size === 0) { rooms.delete(room.roomId); return }
  if (!room.players.has(room.ownerId)) room.ownerId = room.players.values().next().value.userId
  io.to(`room_${room.roomId}`).emit('phase_changed', { phase: 'waiting' })
  io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
}

export function niuniuHandler(socket, io) {
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
    if (activePlayers.length >= 2 && activePlayers.every(pp => pp.isReady && !pp.offline)) {
      startDealingHidden(io, room)
    }
  })

  socket.on('rob_choice', ({ wantsRob }) => {
    const userId = socket.data.userId
    if (!userId) return
    const room = findUserRoom(userId)
    if (!room || room.phase !== 'robbing') return
    const p = room.players.get(userId)
    if (!p || p.hasRobbed || p.offline || p.role === 'spectator') return
    p.hasRobbed = true; p.wantsRob = !!wantsRob
    io.to(`room_${room.roomId}`).emit('rob_choice_made', { userId, wantsRob: p.wantsRob })
    io.to(`room_${room.roomId}`).emit('room_update', formatRoomUpdate(room))
    if (Array.from(room.players.values()).filter(x => x.role === 'player').every(pp => pp.hasRobbed)) { clearCountdown(room); finishRobbing(io, room) }
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
}
